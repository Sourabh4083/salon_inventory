import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { BillItemKind, BillStatus, PaymentMethod } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { applyChange, lockProduct } from "@/lib/services/inventory";
import { closeEnquiryForBill } from "@/lib/services/enquiries";
import { fromPaise, toPaise } from "@/lib/money";
import { APP_TIMEZONE, runtimeZone } from "@/lib/timezone";
import { endOfDay, startOfDay } from "@/lib/dates";
import { can } from "@/lib/permissions";
import type { BillCreateData, BillPaymentData, BillUpdateData } from "@/lib/validation/schemas";
import { PAGE_SIZE } from "@/lib/constants";

/* ---------- DTOs ---------- */

export type BillItemDTO = {
  id: string;
  kind: BillItemKind;
  productId: string | null;
  serviceId: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type BillDTO = {
  id: string;
  billNumber: string;
  status: BillStatus;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: string;
  discount: string;
  total: string;
  /** Method of the money taken at the counter; null when nothing was paid then (pay later). */
  paymentMethod: PaymentMethod | null;
  /** Everything received so far, and what is still owed. */
  amountPaid: string;
  balanceDue: string;
  payments: BillPaymentDTO[];
  notes: string | null;
  itemCount: number;
  items: BillItemDTO[];
  createdAt: string;
  createdByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  /** Owner only: pages must not show these to the manager. */
  editedAt: string | null;
  editedByName: string | null;
};

export type BillPaymentDTO = {
  id: string;
  amount: string;
  method: PaymentMethod;
  paidAt: string;
  /** Taken at the counter when the bill was made (changed only by editing the bill). */
  atBilling: boolean;
  createdById: string;
  createdByName: string;
};

export type ServiceDTO = { id: string; name: string; price: string; isActive: boolean };

const billInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  payments: { orderBy: [{ paidAt: "asc" as const }, { createdAt: "asc" as const }], include: { createdBy: { select: { name: true } } } },
  createdBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
  editedBy: { select: { name: true } },
} satisfies Prisma.BillInclude;

type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

function toBillDTO(b: BillRow): BillDTO {
  return {
    id: b.id,
    billNumber: b.billNumber,
    status: b.status,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    subtotal: b.subtotal.toFixed(2),
    discount: b.discount.toFixed(2),
    total: b.total.toFixed(2),
    paymentMethod: b.paymentMethod,
    amountPaid: fromPaise(b.payments.reduce((n, p) => n + toPaise(p.amount.toString()), 0)),
    balanceDue: b.balanceDue.toFixed(2),
    payments: b.payments.map((p) => ({
      id: p.id,
      amount: p.amount.toFixed(2),
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      atBilling: p.atBilling,
      createdById: p.createdById,
      createdByName: p.createdBy.name,
    })),
    notes: b.notes,
    itemCount: b.items.reduce((n, i) => n + i.quantity, 0),
    items: b.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      productId: i.productId,
      serviceId: i.serviceId,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
    })),
    createdAt: b.createdAt.toISOString(),
    createdByName: b.createdBy.name,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    cancelledByName: b.cancelledBy?.name ?? null,
    cancelReason: b.cancelReason,
    editedAt: b.editedAt ? b.editedAt.toISOString() : null,
    editedByName: b.editedBy?.name ?? null,
  };
}

async function nextBillNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('bill_number_seq') AS n`;
  return `BILL-${String(rows[0].n).padStart(6, "0")}`;
}

/** Serialises payments, edits and cancellation of one bill so the balance can't drift. */
async function lockBill(tx: Prisma.TransactionClient, billId: string) {
  await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
}

/** Paise taken at the counter: the whole total, or what a pay-later customer paid now. */
function counterPaise(data: { payLater: boolean; paidNow: string }, total: number) {
  if (!data.payLater) return total;
  const paid = toPaise(data.paidNow);
  if (paid > total) throw new AppError("Paid now cannot be more than the bill total.");
  return paid;
}

function isToday(d: Date, now = new Date()) {
  return d >= startOfDay(now) && d <= endOfDay(now);
}

/* ---------- Create ---------- */

/**
 * Creates a bill and reduces stock for every product line in one transaction.
 * Product rows are locked in a stable order so two concurrent bills cannot deadlock
 * or oversell the last unit. If any line lacks stock, nothing is saved.
 */
export async function createBill(data: BillCreateData, actor: SessionUser): Promise<BillDTO> {
  // Merge duplicate product lines so stock is checked against the combined quantity.
  const productQty = new Map<string, number>();
  for (const item of data.items) {
    if (item.kind === "PRODUCT") productQty.set(item.productId, (productQty.get(item.productId) ?? 0) + item.quantity);
  }

  const billId = await prisma.$transaction(async (tx) => {
    const productIds = [...productQty.keys()].sort();
    const products = new Map<string, Awaited<ReturnType<typeof lockProduct>>>();
    for (const id of productIds) {
      const locked = await lockProduct(tx, id);
      if (locked.status !== "ACTIVE") throw new AppError(`"${locked.name}" is archived and cannot be sold.`);
      const need = productQty.get(id)!;
      if (locked.quantity < need) {
        throw new AppError(
          locked.quantity === 0
            ? `"${locked.name}" is out of stock.`
            : `Only ${locked.quantity} of "${locked.name}" available, but the bill needs ${need}.`,
          "INSUFFICIENT_STOCK",
        );
      }
      products.set(id, locked);
    }

    const serviceIds = data.items.flatMap((i) => (i.kind === "SERVICE" && i.serviceId ? [i.serviceId] : []));
    const services = new Map<string, { id: string; name: string }>();
    if (serviceIds.length) {
      for (const s of await tx.service.findMany({ where: { id: { in: serviceIds } } })) services.set(s.id, s);
    }

    let subtotal = 0;
    const items: Prisma.BillItemCreateManyBillInput[] = data.items.map((item, index) => {
      const unitPrice = toPaise(item.unitPrice);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      if (item.kind === "PRODUCT") {
        const p = products.get(item.productId)!;
        return {
          kind: "PRODUCT",
          productId: p.id,
          name: p.name,
          quantity: item.quantity,
          unitPrice: fromPaise(unitPrice),
          unitCost: p.costPrice,
          lineTotal: fromPaise(lineTotal),
          sortOrder: index,
        };
      }
      const s = item.serviceId ? services.get(item.serviceId) : undefined;
      return {
        kind: "SERVICE",
        serviceId: s?.id ?? null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: fromPaise(unitPrice),
        unitCost: null,
        lineTotal: fromPaise(lineTotal),
        sortOrder: index,
      };
    });

    const discount = toPaise(data.discount);
    if (discount < 0) throw new AppError("Discount cannot be negative.");
    if (discount > subtotal) throw new AppError("Discount cannot be more than the bill subtotal.");
    const total = subtotal - discount;
    const paid = counterPaise(data, total);
    const now = new Date();

    const bill = await tx.bill.create({
      data: {
        billNumber: await nextBillNumber(tx),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        subtotal: fromPaise(subtotal),
        discount: fromPaise(discount),
        total: fromPaise(total),
        paymentMethod: paid > 0 ? data.paymentMethod : null,
        balanceDue: fromPaise(total - paid),
        notes: data.notes,
        createdById: actor.id,
        createdAt: now,
        items: { createMany: { data: items } },
        payments: paid > 0 ? { create: { amount: fromPaise(paid), method: data.paymentMethod, paidAt: now, atBilling: true, createdById: actor.id } } : undefined,
      },
    });

    // One SALE movement per product (combined quantity), linked to the bill.
    for (const id of productIds) {
      const p = products.get(id)!;
      const qty = productQty.get(id)!;
      await applyChange(tx, {
        productId: id,
        type: "SALE",
        previousQuantity: p.quantity,
        newQuantity: p.quantity - qty,
        note: `Sold on ${bill.billNumber}`,
        actorId: actor.id,
        billId: bill.id,
      });
    }

    await closeEnquiryForBill(tx, bill, actor.id);

    await recordAudit(tx, {
      action: "BILL_CREATED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `Created ${bill.billNumber} for ${fromPaise(total)} (${items.length} line${items.length === 1 ? "" : "s"}, ${
        paid === total ? data.paymentMethod : `pay later, ${fromPaise(total - paid)} due`
      })`,
      actorId: actor.id,
    });
    return bill.id;
  });

  return (await getBill(billId))!;
}

/* ---------- Read ---------- */

/** Edits are the owner's business: strip the markers before a bill reaches anyone else. */
export function billForViewer(bill: BillDTO, role: SessionUser["role"]): BillDTO {
  return role === "OWNER" ? bill : { ...bill, editedAt: null, editedByName: null };
}

export async function getBill(id: string): Promise<BillDTO | null> {
  const row = await prisma.bill.findUnique({ where: { id }, include: billInclude });
  return row ? toBillDTO(row) : null;
}

export type ListBillsParams = {
  search?: string;
  status?: BillStatus;
  /** Only bills that still owe money, oldest first. */
  unpaid?: boolean;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

const UNPAID: Prisma.BillWhereInput = { status: "COMPLETED", balanceDue: { gt: 0 } };

export async function listBills(params: ListBillsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const where: Prisma.BillWhereInput = params.unpaid ? { ...UNPAID } : {};
  if (params.status && !params.unpaid) where.status = params.status;
  if (params.from || params.to) where.createdAt = { gte: params.from, lte: params.to };
  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { billNumber: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
      { items: { some: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.bill.findMany({ where, orderBy: { createdAt: params.unpaid ? "asc" : "desc" }, include: billInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.bill.count({ where }),
  ]);
  return { items: rows.map(toBillDTO), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Money customers still owe across every open bill. */
export async function getOutstanding(): Promise<{ count: number; amount: string }> {
  const agg = await prisma.bill.aggregate({ where: UNPAID, _count: { _all: true }, _sum: { balanceDue: true } });
  return { count: agg._count._all, amount: fromPaise(toPaise(agg._sum.balanceDue?.toString() ?? "0")) };
}

/* ---------- Payments ---------- */

/**
 * Owner or manager: money a pay-later customer brings in. It can't exceed what is
 * still owed; the bill counts as paid once the balance reaches zero.
 */
export async function addBillPayment(data: BillPaymentData, actor: SessionUser): Promise<BillDTO> {
  if (!can(actor.role, "bill.collect")) throw new AppError("You cannot record bill payments.", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    await lockBill(tx, data.billId);
    const bill = await tx.bill.findUnique({ where: { id: data.billId }, select: { id: true, billNumber: true, status: true, balanceDue: true } });
    if (!bill) throw new AppError("Bill not found.", "NOT_FOUND");
    if (bill.status === "CANCELLED") throw new AppError("This bill is cancelled.");
    const due = toPaise(bill.balanceDue.toString());
    if (due <= 0) throw new AppError("This bill is already fully paid.", "CONFLICT");
    const amount = toPaise(data.amount);
    if (amount > due) throw new AppError(`Only ${fromPaise(due)} is due on this bill.`);

    const payment = await tx.billPayment.create({ data: { billId: bill.id, amount: fromPaise(amount), method: data.method, createdById: actor.id } });
    await tx.bill.update({ where: { id: bill.id }, data: { balanceDue: fromPaise(due - amount) } });
    await recordAudit(tx, {
      action: "BILL_PAYMENT_RECEIVED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `Received ${fromPaise(amount)} (${data.method}) on ${bill.billNumber}; ${due - amount > 0 ? `${fromPaise(due - amount)} still due` : "now fully paid"}`,
      metadata: { paymentId: payment.id, amount: fromPaise(amount), method: data.method },
      actorId: actor.id,
    });
  });
  return (await getBill(data.billId))!;
}

/** Owner: any later payment. Manager: only one they entered today. */
export function mayDeletePayment(p: { atBilling: boolean; createdById: string; createdAt: Date | string }, actor: SessionUser) {
  if (p.atBilling) return false;
  if (actor.role === "OWNER") return true;
  return p.createdById === actor.id && isToday(new Date(p.createdAt));
}

export async function deleteBillPayment(paymentId: string, actor: SessionUser): Promise<BillDTO> {
  if (!can(actor.role, "bill.collect")) throw new AppError("You cannot change bill payments.", "FORBIDDEN");
  const billId = await prisma.$transaction(async (tx) => {
    const found = await tx.billPayment.findUnique({ where: { id: paymentId }, select: { billId: true } });
    if (!found) throw new AppError("Payment not found.", "NOT_FOUND");
    await lockBill(tx, found.billId);
    const payment = await tx.billPayment.findUnique({ where: { id: paymentId }, include: { bill: { select: { billNumber: true, status: true, balanceDue: true } } } });
    if (!payment) throw new AppError("Payment not found.", "NOT_FOUND");
    if (payment.atBilling) throw new AppError("The payment taken when the bill was made can only be changed by editing the bill.");
    if (payment.bill.status === "CANCELLED") throw new AppError("This bill is cancelled.");
    if (!mayDeletePayment(payment, actor)) throw new AppError("Only payments you entered today can be removed. Ask the owner to fix older ones.", "FORBIDDEN");

    await tx.billPayment.delete({ where: { id: payment.id } });
    const due = toPaise(payment.bill.balanceDue.toString()) + toPaise(payment.amount.toString());
    await tx.bill.update({ where: { id: payment.billId }, data: { balanceDue: fromPaise(due) } });
    await recordAudit(tx, {
      action: "BILL_PAYMENT_DELETED",
      entityType: "Bill",
      entityId: payment.billId,
      summary: `Removed payment ${payment.amount.toFixed(2)} (${payment.method}) from ${payment.bill.billNumber}; ${fromPaise(due)} due`,
      metadata: { paymentId: payment.id, amount: payment.amount.toFixed(2), method: payment.method, paidAt: payment.paidAt.toISOString() },
      actorId: actor.id,
    });
    return payment.billId;
  });
  return (await getBill(billId))!;
}

/* ---------- Cancel ---------- */

/**
 * Owner only. Marks the bill CANCELLED and puts product quantities back with
 * BILL_CANCELLED movements. The bill itself is kept for the record.
 */
export async function cancelBill(input: { billId: string; reason: string }, actor: SessionUser): Promise<BillDTO> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can cancel bills.", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    await lockBill(tx, input.billId);
    const bill = await tx.bill.findUnique({ where: { id: input.billId }, include: { items: true } });
    if (!bill) throw new AppError("Bill not found.", "NOT_FOUND");
    if (bill.status === "CANCELLED") throw new AppError("This bill is already cancelled.");

    const restore = new Map<string, number>();
    for (const item of bill.items) {
      if (item.kind === "PRODUCT" && item.productId) restore.set(item.productId, (restore.get(item.productId) ?? 0) + item.quantity);
    }
    for (const id of [...restore.keys()].sort()) {
      const existing = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (!existing) continue; // product was deleted since; nothing to restore
      const locked = await lockProduct(tx, id);
      await applyChange(tx, {
        productId: id,
        type: "BILL_CANCELLED",
        previousQuantity: locked.quantity,
        newQuantity: locked.quantity + restore.get(id)!,
        note: `${bill.billNumber} cancelled: ${input.reason}`,
        actorId: actor.id,
        billId: bill.id,
      });
    }

    await tx.bill.update({
      where: { id: bill.id },
      data: { status: "CANCELLED", cancelledById: actor.id, cancelledAt: new Date(), cancelReason: input.reason },
    });
    await recordAudit(tx, {
      action: "BILL_CANCELLED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `Cancelled ${bill.billNumber} (${bill.total.toFixed(2)}): ${input.reason}`,
      actorId: actor.id,
    });
  });
  return (await getBill(input.billId))!;
}

/* ---------- Edit (owner) ---------- */

/**
 * Owner only. Rewrites a bill: its lines, prices, discount, customer, payment and date.
 *
 * Stock follows the change: for each product the difference between the old and new
 * quantity is taken from (or put back on) the shelf with one BILL_EDITED movement.
 * Reports read bills live by `createdAt`, so moving the date moves the bill's sales,
 * profit and products sold to that day. The previous version is kept in the audit log.
 */
export async function updateBill(data: BillUpdateData, actor: SessionUser): Promise<BillDTO> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can edit bills.", "FORBIDDEN");
  if (data.billedAt.getTime() > Date.now() + 60_000) throw new AppError("The bill date cannot be in the future.");

  const newQty = new Map<string, number>();
  for (const item of data.items) {
    if (item.kind === "PRODUCT") newQty.set(item.productId, (newQty.get(item.productId) ?? 0) + item.quantity);
  }

  await prisma.$transaction(async (tx) => {
    await lockBill(tx, data.billId);
    const bill = await tx.bill.findUnique({ where: { id: data.billId }, include: { items: { orderBy: { sortOrder: "asc" } }, payments: true } });
    if (!bill) throw new AppError("Bill not found.", "NOT_FOUND");
    if (bill.status === "CANCELLED") throw new AppError("A cancelled bill cannot be edited.");

    const oldQty = new Map<string, number>();
    const oldLine = new Map<string, { name: string; unitCost: Prisma.Decimal | null }>();
    for (const item of bill.items) {
      if (item.kind !== "PRODUCT" || !item.productId) continue;
      oldQty.set(item.productId, (oldQty.get(item.productId) ?? 0) + item.quantity);
      if (!oldLine.has(item.productId)) oldLine.set(item.productId, { name: item.name, unitCost: item.unitCost });
    }

    // Lock every product involved, in a stable order, before touching stock.
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])].sort();
    const products = new Map<string, Awaited<ReturnType<typeof lockProduct>>>();
    for (const id of productIds) {
      const exists = await tx.product.findUnique({ where: { id }, select: { id: true } });
      if (exists) products.set(id, await lockProduct(tx, id));
      // A product deleted since the sale can stay on the bill as it was, but not be added or raised.
      else if ((newQty.get(id) ?? 0) > (oldQty.get(id) ?? 0)) throw new AppError("A product on this bill no longer exists.", "NOT_FOUND");
    }

    for (const id of productIds) {
      const p = products.get(id);
      if (!p) continue;
      const delta = (newQty.get(id) ?? 0) - (oldQty.get(id) ?? 0); // + means more sold
      if (delta > 0 && p.status !== "ACTIVE") throw new AppError(`"${p.name}" is archived and cannot be sold.`);
      if (delta > p.quantity) {
        throw new AppError(
          p.quantity === 0 ? `"${p.name}" is out of stock.` : `Only ${p.quantity} more of "${p.name}" available, but the bill needs ${delta} more.`,
          "INSUFFICIENT_STOCK",
        );
      }
    }

    const serviceIds = data.items.flatMap((i) => (i.kind === "SERVICE" && i.serviceId ? [i.serviceId] : []));
    const services = new Set(serviceIds.length ? (await tx.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true } })).map((s) => s.id) : []);

    let subtotal = 0;
    const items: Prisma.BillItemCreateManyBillInput[] = data.items.map((item, index) => {
      const unitPrice = toPaise(item.unitPrice);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      if (item.kind === "PRODUCT") {
        const p = products.get(item.productId);
        const old = oldLine.get(item.productId);
        return {
          kind: "PRODUCT",
          productId: p ? item.productId : null,
          name: p?.name ?? old?.name ?? "Product",
          quantity: item.quantity,
          unitPrice: fromPaise(unitPrice),
          // Lines already on the bill keep the cost known at the sale, so their profit does not shift.
          unitCost: old ? old.unitCost : (p?.costPrice ?? null),
          lineTotal: fromPaise(lineTotal),
          sortOrder: index,
        };
      }
      return {
        kind: "SERVICE",
        serviceId: item.serviceId && services.has(item.serviceId) ? item.serviceId : null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: fromPaise(unitPrice),
        unitCost: null,
        lineTotal: fromPaise(lineTotal),
        sortOrder: index,
      };
    });

    const discount = toPaise(data.discount);
    if (discount < 0) throw new AppError("Discount cannot be negative.");
    if (discount > subtotal) throw new AppError("Discount cannot be more than the bill subtotal.");
    const total = subtotal - discount;

    // Payments collected after billing stay as they were; the counter payment follows the form
    // (and the bill's date) only while nothing else has been collected.
    const counter = bill.payments.find((p) => p.atBilling);
    const laterPaid = bill.payments.filter((p) => !p.atBilling).reduce((n, p) => n + toPaise(p.amount.toString()), 0);
    let paymentMethod = bill.paymentMethod;
    let balance: number;
    if (laterPaid > 0) {
      const paid = laterPaid + (counter ? toPaise(counter.amount.toString()) : 0);
      if (total < paid) throw new AppError(`${fromPaise(paid)} has already been received on this bill, so the total can't be less than that.`);
      balance = total - paid;
      if (counter) await tx.billPayment.update({ where: { id: counter.id }, data: { paidAt: data.billedAt } });
    } else {
      const paid = counterPaise(data, total);
      balance = total - paid;
      paymentMethod = paid > 0 ? data.paymentMethod : null;
      if (counter) await tx.billPayment.delete({ where: { id: counter.id } });
      if (paid > 0) {
        await tx.billPayment.create({
          data: { billId: bill.id, amount: fromPaise(paid), method: data.paymentMethod, paidAt: data.billedAt, atBilling: true, createdById: counter?.createdById ?? bill.createdById },
        });
      }
    }

    for (const id of productIds) {
      const p = products.get(id);
      const delta = (newQty.get(id) ?? 0) - (oldQty.get(id) ?? 0);
      if (!p || delta === 0) continue;
      await applyChange(tx, {
        productId: id,
        type: "BILL_EDITED",
        previousQuantity: p.quantity,
        newQuantity: p.quantity - delta,
        note: `${bill.billNumber} edited: ${oldQty.get(id) ?? 0} → ${newQty.get(id) ?? 0} sold`,
        actorId: actor.id,
        billId: bill.id,
      });
    }

    await tx.billItem.deleteMany({ where: { billId: bill.id } });
    await tx.bill.update({
      where: { id: bill.id },
      data: {
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        subtotal: fromPaise(subtotal),
        discount: fromPaise(discount),
        total: fromPaise(total),
        paymentMethod,
        balanceDue: fromPaise(balance),
        notes: data.notes,
        createdAt: data.billedAt,
        editedAt: new Date(),
        editedById: actor.id,
        items: { createMany: { data: items } },
      },
    });

    const dateMoved = bill.createdAt.getTime() !== data.billedAt.getTime();
    await recordAudit(tx, {
      action: "BILL_EDITED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `Edited ${bill.billNumber}: total ${bill.total.toFixed(2)} → ${fromPaise(total)}${dateMoved ? " (date changed)" : ""}`,
      metadata: {
        before: {
          createdAt: bill.createdAt.toISOString(),
          customerName: bill.customerName,
          customerPhone: bill.customerPhone,
          subtotal: bill.subtotal.toFixed(2),
          discount: bill.discount.toFixed(2),
          total: bill.total.toFixed(2),
          paymentMethod: bill.paymentMethod,
          balanceDue: bill.balanceDue.toFixed(2),
          notes: bill.notes,
          items: bill.items.map((i) => ({ kind: i.kind, productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice.toFixed(2) })),
        },
        after: { createdAt: data.billedAt.toISOString(), total: fromPaise(total) },
      },
      actorId: actor.id,
    });
  });

  return (await getBill(data.billId))!;
}

/** Owner: the bill's total and date before its first edit, from the audit log. */
export async function getOriginalBillSummary(billId: string): Promise<{ total: string; createdAt: string } | null> {
  const first = await prisma.auditLog.findFirst({ where: { action: "BILL_EDITED", entityId: billId }, orderBy: { createdAt: "asc" }, select: { metadata: true } });
  const before = (first?.metadata as { before?: { total?: string; createdAt?: string } } | null)?.before;
  return before?.total && before.createdAt ? { total: before.total, createdAt: before.createdAt } : null;
}

/* ---------- Services catalogue ---------- */

function toServiceDTO(s: { id: string; name: string; price: Prisma.Decimal; isActive: boolean }): ServiceDTO {
  return { id: s.id, name: s.name, price: s.price.toFixed(2), isActive: s.isActive };
}

export async function listServices(opts: { activeOnly?: boolean } = {}): Promise<ServiceDTO[]> {
  const rows = await prisma.service.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toServiceDTO);
}

export async function createService(input: { name: string; price: string }, actor: SessionUser): Promise<ServiceDTO> {
  const dup = await prisma.service.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
  if (dup) throw new AppError("A service with this name already exists.", "CONFLICT");
  const max = await prisma.service.aggregate({ _max: { sortOrder: true } });
  const s = await prisma.service.create({ data: { name: input.name, price: input.price, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await recordAudit(prisma, {
    action: "SERVICE_CREATED",
    entityType: "Service",
    entityId: s.id,
    summary: `Added service "${s.name}" at ${s.price.toFixed(2)}`,
    actorId: actor.id,
  });
  return toServiceDTO(s);
}

export async function updateService(
  id: string,
  input: { name?: string; price?: string; isActive?: boolean },
  actor: SessionUser,
): Promise<ServiceDTO> {
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) throw new AppError("Service not found.", "NOT_FOUND");
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await prisma.service.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } });
    if (dup) throw new AppError("A service with this name already exists.", "CONFLICT");
  }
  const s = await prisma.service.update({ where: { id }, data: { name: input.name, price: input.price, isActive: input.isActive } });
  await recordAudit(prisma, {
    action: "SERVICE_UPDATED",
    entityType: "Service",
    entityId: s.id,
    summary: `Updated service "${s.name}" (${s.price.toFixed(2)}, ${s.isActive ? "active" : "hidden"})`,
    actorId: actor.id,
  });
  return toServiceDTO(s);
}

/* ---------- Reports (owner) ---------- */

export type SalesReport = {
  from: string;
  to: string;
  billCount: number;
  cancelledCount: number;
  revenue: string;
  discount: string;
  productRevenue: string;
  serviceRevenue: string;
  /** Cost of products sold, where a cost price was known at the time of sale. */
  cost: string;
  grossProfit: string;
  unitsSold: number;
  /** Money actually received in the period (including dues collected on older bills), by method. */
  byPayment: { method: PaymentMethod; count: number; amount: string }[];
  /** Still owed on this period's bills. */
  toCollect: string;
  unpaidCount: number;
  byDay: { date: string; billCount: number; amount: string }[];
  topProducts: { productId: string | null; name: string; quantity: number; amount: string }[];
  topServices: { name: string; quantity: number; amount: string }[];
};

export async function getSalesReport(range: { from: Date; to: Date }): Promise<SalesReport> {
  const where: Prisma.BillWhereInput = { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } };

  const [agg, cancelledCount, unpaid, byPaymentRows, itemRows, dayRows] = await Promise.all([
    prisma.bill.aggregate({ where, _count: { _all: true }, _sum: { total: true, discount: true } }),
    prisma.bill.count({ where: { status: "CANCELLED", createdAt: { gte: range.from, lte: range.to } } }),
    prisma.bill.aggregate({ where: { ...where, balanceDue: { gt: 0 } }, _count: { _all: true }, _sum: { balanceDue: true } }),
    prisma.billPayment.groupBy({
      by: ["method"],
      where: { paidAt: { gte: range.from, lte: range.to }, bill: { status: "COMPLETED" } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.billItem.findMany({
      where: { bill: where },
      select: { kind: true, productId: true, name: true, quantity: true, lineTotal: true, unitCost: true },
    }),
    // Bucket by the salon's calendar day, not the host's: a bill rung up at 9 PM IST
    // is 3:30 PM UTC, and grouping on the raw column would file it under the wrong day.
    // The column is naive, so it is first read back in the zone it was written in.
    prisma.$queryRaw<{ day: string; bills: bigint; amount: Prisma.Decimal | null }[]>`
      SELECT to_char(
               date_trunc('day', "createdAt" AT TIME ZONE ${runtimeZone()}::text AT TIME ZONE ${APP_TIMEZONE}::text),
               'YYYY-MM-DD'
             ) AS day,
             COUNT(*) AS bills,
             SUM(total) AS amount
      FROM "Bill"
      WHERE status = 'COMPLETED' AND "createdAt" >= ${range.from} AND "createdAt" <= ${range.to}
      GROUP BY 1 ORDER BY 1`,
  ]);

  let productRevenue = 0;
  let serviceRevenue = 0;
  let cost = 0;
  let unitsSold = 0;
  const products = new Map<string, { productId: string | null; name: string; quantity: number; amount: number }>();
  const services = new Map<string, { name: string; quantity: number; amount: number }>();
  for (const i of itemRows) {
    const amount = toPaise(i.lineTotal.toString());
    if (i.kind === "PRODUCT") {
      productRevenue += amount;
      unitsSold += i.quantity;
      if (i.unitCost) cost += toPaise(i.unitCost.toString()) * i.quantity;
      const key = i.productId ?? `name:${i.name}`;
      const cur = products.get(key) ?? { productId: i.productId, name: i.name, quantity: 0, amount: 0 };
      cur.quantity += i.quantity;
      cur.amount += amount;
      products.set(key, cur);
    } else {
      serviceRevenue += amount;
      const key = i.name.toLowerCase();
      const cur = services.get(key) ?? { name: i.name, quantity: 0, amount: 0 };
      cur.quantity += i.quantity;
      cur.amount += amount;
      services.set(key, cur);
    }
  }
  const discount = toPaise(agg._sum.discount?.toString() ?? "0");
  const revenue = toPaise(agg._sum.total?.toString() ?? "0");
  // The discount applies to the whole bill, so share it across products proportionally
  // before computing gross profit on products.
  const gross = productRevenue + serviceRevenue;
  const productDiscountShare = gross > 0 ? Math.round((discount * productRevenue) / gross) : 0;
  const grossProfit = productRevenue - productDiscountShare - cost;

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    billCount: agg._count._all,
    cancelledCount,
    revenue: fromPaise(revenue),
    discount: fromPaise(discount),
    productRevenue: fromPaise(productRevenue),
    serviceRevenue: fromPaise(serviceRevenue),
    cost: fromPaise(cost),
    grossProfit: fromPaise(grossProfit),
    unitsSold,
    byPayment: (["CASH", "UPI", "CARD"] as PaymentMethod[]).map((method) => {
      const r = byPaymentRows.find((x) => x.method === method);
      return { method, count: r?._count._all ?? 0, amount: fromPaise(toPaise(r?._sum.amount?.toString() ?? "0")) };
    }),
    toCollect: fromPaise(toPaise(unpaid._sum.balanceDue?.toString() ?? "0")),
    unpaidCount: unpaid._count._all,
    byDay: dayRows.map((d) => ({
      date: d.day,
      billCount: Number(d.bills),
      amount: fromPaise(toPaise(d.amount?.toString() ?? "0")),
    })),
    topProducts: [...products.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((p) => ({ ...p, amount: fromPaise(p.amount) })),
    topServices: [...services.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((s) => ({ ...s, amount: fromPaise(s.amount) })),
  };
}
