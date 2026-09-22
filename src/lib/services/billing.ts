import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { BillItemKind, BillStatus, PaymentMethod } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { applyChange, lockProduct } from "@/lib/services/inventory";
import { fromPaise, toPaise } from "@/lib/money";
import { APP_TIMEZONE, runtimeZone } from "@/lib/timezone";
import type { BillCreateData } from "@/lib/validation/schemas";
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
  paymentMethod: PaymentMethod;
  notes: string | null;
  itemCount: number;
  items: BillItemDTO[];
  createdAt: string;
  createdByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
};

export type ServiceDTO = { id: string; name: string; price: string; isActive: boolean };

const billInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  createdBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
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
  };
}

async function nextBillNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('bill_number_seq') AS n`;
  return `BILL-${String(rows[0].n).padStart(6, "0")}`;
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

    const bill = await tx.bill.create({
      data: {
        billNumber: await nextBillNumber(tx),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        subtotal: fromPaise(subtotal),
        discount: fromPaise(discount),
        total: fromPaise(total),
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        createdById: actor.id,
        items: { createMany: { data: items } },
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

    await recordAudit(tx, {
      action: "BILL_CREATED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `Created ${bill.billNumber} for ${fromPaise(total)} (${items.length} line${items.length === 1 ? "" : "s"}, ${data.paymentMethod})`,
      actorId: actor.id,
    });
    return bill.id;
  });

  return (await getBill(billId))!;
}

/* ---------- Read ---------- */

export async function getBill(id: string): Promise<BillDTO | null> {
  const row = await prisma.bill.findUnique({ where: { id }, include: billInclude });
  return row ? toBillDTO(row) : null;
}

export type ListBillsParams = {
  search?: string;
  status?: BillStatus;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export async function listBills(params: ListBillsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const where: Prisma.BillWhereInput = {};
  if (params.status) where.status = params.status;
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
    prisma.bill.findMany({ where, orderBy: { createdAt: "desc" }, include: billInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.bill.count({ where }),
  ]);
  return { items: rows.map(toBillDTO), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/* ---------- Cancel ---------- */

/**
 * Owner only. Marks the bill CANCELLED and puts product quantities back with
 * BILL_CANCELLED movements. The bill itself is kept for the record.
 */
export async function cancelBill(input: { billId: string; reason: string }, actor: SessionUser): Promise<BillDTO> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can cancel bills.", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
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
  byPayment: { method: PaymentMethod; count: number; amount: string }[];
  byDay: { date: string; billCount: number; amount: string }[];
  topProducts: { productId: string | null; name: string; quantity: number; amount: string }[];
  topServices: { name: string; quantity: number; amount: string }[];
};

export async function getSalesReport(range: { from: Date; to: Date }): Promise<SalesReport> {
  const where: Prisma.BillWhereInput = { status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } };

  const [agg, cancelledCount, byPaymentRows, itemRows, dayRows] = await Promise.all([
    prisma.bill.aggregate({ where, _count: { _all: true }, _sum: { total: true, discount: true } }),
    prisma.bill.count({ where: { status: "CANCELLED", createdAt: { gte: range.from, lte: range.to } } }),
    prisma.bill.groupBy({ by: ["paymentMethod"], where, _count: { _all: true }, _sum: { total: true } }),
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
      const r = byPaymentRows.find((x) => x.paymentMethod === method);
      return { method, count: r?._count._all ?? 0, amount: fromPaise(toPaise(r?._sum.total?.toString() ?? "0")) };
    }),
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
