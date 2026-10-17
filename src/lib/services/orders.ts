import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, PaymentMethod, Role } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { applyChange, lockProduct } from "@/lib/services/inventory";
import { fromPaise, toPaise } from "@/lib/money";
import { PAGE_SIZE } from "@/lib/constants";
import type { OrderCostsData, OrderCreateData, OrderReceiveData } from "@/lib/validation/schemas";

/* ---------- DTOs ---------- */

export type OrderItemDTO = {
  id: string;
  /** null once the product has been deleted; the line then can't be received. */
  productId: string | null;
  name: string;
  quantityOrdered: number;
  quantityReceived: number;
  pending: number;
  /** Owner-only; null for managers. */
  unitCost: string | null;
  /** Current shelf quantity, for context while ordering and receiving. */
  inStock: number | null;
};

export type OrderReceiptDTO = {
  id: string;
  productName: string;
  quantity: number;
  performedByName: string;
  createdAt: string;
};

export type OrderDTO = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  notes: string | null;
  createdAt: string;
  createdByName: string;
  closedAt: string | null;
  closedByName: string | null;
  closeReason: string | null;
  items: OrderItemDTO[];
  totalOrdered: number;
  totalReceived: number;
  /** Units still expected. On a CLOSED order these are the units that never came. */
  totalPending: number;
  /** Owner-only; null for managers. */
  cgst: string | null;
  sgst: string | null;
  /** True once the GST has been charged to cash/bank (with the order, or the first delivery on older orders). */
  gstPaid: boolean;
  /** When the order was paid for, at the time it was placed; null on older orders paid on each delivery. */
  paidAt: string | null;
  paymentMethod: PaymentMethod | null;
  /** Owner-only: items plus GST; null for managers or when nothing has a cost. */
  totalCost: string | null;
  /** Lines that can still be booked in (pending and product still exists). */
  receivableLines: number;
};

export type OrderDetailDTO = OrderDTO & { receipts: OrderReceiptDTO[] };

const orderInclude = {
  items: { orderBy: { sortOrder: "asc" as const }, include: { product: { select: { quantity: true } } } },
  createdBy: { select: { name: true } },
  closedBy: { select: { name: true } },
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

function toOrderDTO(o: OrderRow): OrderDTO {
  let totalOrdered = 0;
  let totalReceived = 0;
  let cost = 0;
  let hasCost = false;
  let receivableLines = 0;
  const items = o.items.map((i) => {
    const pending = Math.max(0, i.quantityOrdered - i.quantityReceived);
    totalOrdered += i.quantityOrdered;
    totalReceived += i.quantityReceived;
    if (i.unitCost) {
      hasCost = true;
      cost += toPaise(i.unitCost.toString()) * i.quantityOrdered;
    }
    if (pending > 0 && i.productId) receivableLines++;
    return {
      id: i.id,
      productId: i.productId,
      name: i.name,
      quantityOrdered: i.quantityOrdered,
      quantityReceived: i.quantityReceived,
      pending,
      unitCost: i.unitCost ? i.unitCost.toFixed(2) : null,
      inStock: i.product?.quantity ?? null,
    };
  });
  const gst = orderGstPaise(o);
  if (gst > 0) {
    hasCost = true;
    cost += gst;
  }
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    notes: o.notes,
    createdAt: o.createdAt.toISOString(),
    createdByName: o.createdBy.name,
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    closedByName: o.closedBy?.name ?? null,
    closeReason: o.closeReason,
    items,
    totalOrdered,
    totalReceived,
    totalPending: totalOrdered - totalReceived,
    cgst: o.cgst ? o.cgst.toFixed(2) : null,
    sgst: o.sgst ? o.sgst.toFixed(2) : null,
    gstPaid: o.gstPaidAt !== null,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    paymentMethod: o.paymentMethod,
    totalCost: hasCost ? fromPaise(cost) : null,
    receivableLines,
  };
}

export function orderGstPaise(o: { cgst: { toString(): string } | null; sgst: { toString(): string } | null }) {
  return toPaise(o.cgst?.toString() ?? "0") + toPaise(o.sgst?.toString() ?? "0");
}

/** On a prepaid order the GST is paid with the order; no GST, nothing paid. */
function gstPaid(gst: Parameters<typeof orderGstPaise>[0], paidAt: Date, method: PaymentMethod) {
  return orderGstPaise(gst) > 0 ? { gstPaidAt: paidAt, gstPaymentMethod: method } : { gstPaidAt: null, gstPaymentMethod: null };
}

/** Costs are owner-only, same rule as productForViewer. */
export function orderForViewer<T extends OrderDTO>(dto: T, role: Role): T {
  if (role === "OWNER") return dto;
  return { ...dto, totalCost: null, cgst: null, sgst: null, items: dto.items.map((i) => ({ ...i, unitCost: null })) };
}

async function nextOrderNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  return `ORD-${String(rows[0].n).padStart(6, "0")}`;
}

/** Serialises every write to one order (double-clicked "Received", two people receiving at once). */
async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string; status: OrderStatus; orderNumber: string }[]>`
    SELECT id, status, "orderNumber" FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError("Order not found.", "NOT_FOUND");
  return row;
}

function requireOwner(actor: SessionUser, what: string) {
  if (actor.role !== "OWNER") throw new AppError(`Only the owner can ${what}.`, "FORBIDDEN");
}

/**
 * Merges duplicate products, checks each one exists and is active, and builds the
 * line snapshots. A line without a typed cost falls back to the product's cost price.
 */
async function buildLines(tx: Prisma.TransactionClient, items: OrderCreateData["items"]) {
  const merged = new Map<string, { quantity: number; unitCost: string | null }>();
  for (const item of items) {
    const cur = merged.get(item.productId);
    merged.set(item.productId, {
      quantity: (cur?.quantity ?? 0) + item.quantity,
      unitCost: item.unitCost ?? cur?.unitCost ?? null,
    });
  }
  const products = await tx.product.findMany({
    where: { id: { in: [...merged.keys()] } },
    select: { id: true, name: true, status: true, costPrice: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  let index = 0;
  const lines: Prisma.PurchaseOrderItemCreateManyPurchaseOrderInput[] = [];
  for (const [productId, line] of merged) {
    const p = byId.get(productId);
    if (!p) throw new AppError("One of the products no longer exists. Remove it and try again.", "NOT_FOUND");
    if (p.status !== "ACTIVE") throw new AppError(`"${p.name}" is archived. Restore it before ordering.`);
    lines.push({
      productId,
      name: p.name,
      quantityOrdered: line.quantity,
      unitCost: line.unitCost ?? p.costPrice,
      sortOrder: index++,
    });
  }
  return lines;
}

/* ---------- Create / edit ---------- */

/**
 * Places the order and pays for it: the whole ordered amount (and the GST) leaves
 * cash/bank now. Stock does not change until products are received. Costs are
 * owner-only: a manager's order takes each product's saved cost price instead.
 */
export async function createOrder(data: OrderCreateData, actor: SessionUser, now = new Date()): Promise<OrderDetailDTO> {
  const isOwner = actor.role === "OWNER";
  const items = isOwner ? data.items : data.items.map((i) => ({ ...i, unitCost: null }));
  const gst = isOwner ? { cgst: data.cgst, sgst: data.sgst } : { cgst: null, sgst: null };
  const orderId = await prisma.$transaction(async (tx) => {
    const lines = await buildLines(tx, items);
    const order = await tx.purchaseOrder.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        notes: data.notes,
        ...gst,
        ...gstPaid(gst, now, data.paymentMethod),
        paidAt: now,
        paymentMethod: data.paymentMethod,
        createdById: actor.id,
        items: { createMany: { data: lines } },
      },
    });
    const units = lines.reduce((n, l) => n + l.quantityOrdered, 0);
    await recordAudit(tx, {
      action: "ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: order.id,
      summary: `Placed ${order.orderNumber}: ${lines.length} product${lines.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}, paid by ${data.paymentMethod}`,
      actorId: actor.id,
    });
    return order.id;
  });
  return (await getOrder(orderId))!;
}

/** Owner only. Replaces the lines and notes while nothing has been received yet. */
export async function updateOrder(orderId: string, data: OrderCreateData, actor: SessionUser): Promise<OrderDetailDTO> {
  requireOwner(actor, "edit orders");
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "ACTIVE") throw new AppError("Only active orders can be edited.");
    const received = await tx.purchaseOrderItem.count({ where: { purchaseOrderId: orderId, quantityReceived: { gt: 0 } } });
    if (received > 0) throw new AppError("Products on this order have already been received, so it can no longer be edited.");
    const lines = await buildLines(tx, data.items);
    const { paidAt } = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, select: { paidAt: true } });
    // The amount paid follows the edited lines; an older order is still paid on delivery.
    const paid = paidAt ? { paymentMethod: data.paymentMethod, ...gstPaid(data, paidAt, data.paymentMethod) } : {};
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: orderId } });
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { notes: data.notes, cgst: data.cgst, sgst: data.sgst, ...paid, items: { createMany: { data: lines } } },
    });
    await recordAudit(tx, {
      action: "ORDER_UPDATED",
      entityType: "PurchaseOrder",
      entityId: orderId,
      summary: `Edited ${order.orderNumber}: now ${lines.length} product${lines.length === 1 ? "" : "s"}`,
      actorId: actor.id,
    });
  });
  return (await getOrder(orderId))!;
}

/**
 * Owner only. Fixes the money on an order that has had deliveries (cost per unit, GST,
 * note). Quantities and stock are not touched. Deliveries already booked take the new
 * cost, so Cash vs Bank and the reports follow; a product whose cost price came from
 * this order takes it too. GST added afterwards counts as paid with the first delivery.
 */
export async function updateOrderCosts(orderId: string, data: OrderCostsData, actor: SessionUser): Promise<OrderDetailDTO> {
  requireOwner(actor, "edit orders");
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: orderId } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const changes: string[] = [];

    for (const line of data.items) {
      const item = byId.get(line.itemId);
      if (!item) throw new AppError("That product is not on this order.", "NOT_FOUND");
      // Blank keeps the cost as it is.
      if (line.unitCost === null) continue;
      const before = item.unitCost?.toFixed(2) ?? null;
      const after = Number(line.unitCost).toFixed(2);
      if (before === after) continue;
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { unitCost: after } });
      if (item.productId) {
        // A line without a cost was booked at the product's cost price at the time.
        const booked = before ?? (await tx.stockMovement.findFirst({ where: { purchaseOrderId: orderId, productId: item.productId, type: "STOCK_IN" }, select: { unitCost: true } }))?.unitCost?.toFixed(2) ?? null;
        await tx.stockMovement.updateMany({ where: { purchaseOrderId: orderId, productId: item.productId, type: "STOCK_IN" }, data: { unitCost: after } });
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { costPrice: true } });
        if (product && item.quantityReceived > 0 && (product.costPrice === null || product.costPrice.toFixed(2) === booked)) {
          await tx.product.update({ where: { id: item.productId }, data: { costPrice: after } });
        }
      }
      changes.push(`${item.name} ${before ?? "no cost"} → ${after}`);
    }

    const current = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { cgst: true, sgst: true, notes: true, gstPaidAt: true, paidAt: true, paymentMethod: true },
    });
    const orderData: Prisma.PurchaseOrderUpdateInput = { cgst: data.cgst, sgst: data.sgst, notes: data.notes };
    const gst = orderGstPaise(data);
    if (gst !== orderGstPaise(current)) changes.push(`GST ${fromPaise(orderGstPaise(current))} → ${fromPaise(gst)}`);
    if (current.paidAt && current.paymentMethod) {
      // Prepaid: GST belongs to the payment made with the order.
      Object.assign(orderData, gstPaid(data, current.paidAt, current.paymentMethod));
    } else if (gst === 0) {
      orderData.gstPaidAt = null;
      orderData.gstPaymentMethod = null;
    } else if (!current.gstPaidAt) {
      // Paid with the bill, i.e. the first delivery; with no delivery yet it is charged on receipt.
      const first = await tx.stockMovement.findFirst({
        where: { purchaseOrderId: orderId, type: "STOCK_IN", paymentMethod: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, paymentMethod: true },
      });
      if (first) {
        orderData.gstPaidAt = first.createdAt;
        orderData.gstPaymentMethod = first.paymentMethod;
      }
    }
    if ((current.notes ?? null) !== data.notes) changes.push("note");
    await tx.purchaseOrder.update({ where: { id: orderId }, data: orderData });

    await recordAudit(tx, {
      action: "ORDER_UPDATED",
      entityType: "PurchaseOrder",
      entityId: orderId,
      summary: `Fixed amounts on ${order.orderNumber}${changes.length ? `: ${changes.join(", ")}` : ""}`,
      actorId: actor.id,
    });
  });
  return (await getOrder(orderId))!;
}

/* ---------- Receive ---------- */

/**
 * Books a delivery into stock. "ALL" takes every pending unit; otherwise only the
 * quantities given (0 = didn't arrive). Each received product gets one STOCK_IN
 * movement linked to the order, and its cost price is updated to the order's cost.
 * The order stays ACTIVE until nothing is pending, then becomes RECEIVED.
 *
 * Lock order is always order row first, then products by id, so this cannot
 * deadlock with billing or another receipt.
 */
export async function receiveOrder(input: OrderReceiveData, actor: SessionUser): Promise<OrderDetailDTO> {
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (order.status === "RECEIVED") throw new AppError(`${order.orderNumber} has already been fully received.`, "CONFLICT");
    if (order.status === "CLOSED") throw new AppError(`${order.orderNumber} is closed.`, "CONFLICT");

    const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id } });
    const byId = new Map(items.map((i) => [i.id, i]));

    const take = new Map<string, number>(); // itemId -> quantity arriving now
    if (input.lines === "ALL") {
      for (const i of items) {
        const pending = i.quantityOrdered - i.quantityReceived;
        if (pending > 0 && i.productId) take.set(i.id, pending);
      }
    } else {
      for (const line of input.lines) {
        const item = byId.get(line.itemId);
        if (!item) throw new AppError("That product is not on this order.", "NOT_FOUND");
        if (take.has(item.id)) throw new AppError(`"${item.name}" is listed twice.`);
        if (line.quantity === 0) continue;
        const pending = item.quantityOrdered - item.quantityReceived;
        if (!item.productId) throw new AppError(`"${item.name}" was deleted from inventory and can't be received.`);
        if (line.quantity > pending) {
          throw new AppError(
            pending === 0
              ? `"${item.name}" has already been fully received.`
              : `Only ${pending} of "${item.name}" ${pending === 1 ? "is" : "are"} still pending. Use Add Stock for any extra.`,
          );
        }
        take.set(item.id, line.quantity);
      }
    }
    if (take.size === 0) throw new AppError("Nothing to receive. Enter the quantity that arrived.");

    // A prepaid order was paid for when placed, so receiving it only books the stock.
    const current = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, select: { cgst: true, sgst: true, gstPaidAt: true, paidAt: true } });
    const prepaid = current.paidAt !== null;

    const lines = [...take.entries()]
      .map(([itemId, quantity]) => ({ item: byId.get(itemId)!, quantity }))
      .sort((a, b) => (a.item.productId! < b.item.productId! ? -1 : 1));

    for (const { item, quantity } of lines) {
      const product = await lockProduct(tx, item.productId!);
      await applyChange(tx, {
        productId: product.id,
        type: "STOCK_IN",
        previousQuantity: product.quantity,
        newQuantity: product.quantity + quantity,
        // A line ordered before the product had a cost uses the cost price set since.
        unitCost: item.unitCost?.toFixed(2) ?? product.costPrice,
        paymentMethod: prepaid ? null : input.paymentMethod,
        note: `Received on ${order.orderNumber}`,
        actorId: actor.id,
        purchaseOrderId: order.id,
      });
      // Keep Prices & Margins current with what was actually paid.
      if (item.unitCost && item.unitCost.toFixed(2) !== product.costPrice) {
        await tx.product.update({ where: { id: product.id }, data: { costPrice: item.unitCost } });
      }
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { quantityReceived: { increment: quantity } },
      });
    }

    // Lines whose product was deleted can never arrive, so they don't hold the order open.
    const stillPending = items.some((i) => i.productId && i.quantityOrdered - i.quantityReceived - (take.get(i.id) ?? 0) > 0);
    const orderData: Prisma.PurchaseOrderUpdateInput = {};
    if (!prepaid && !current.gstPaidAt) {
      // The bill comes with the delivery, so the owner may type or correct its GST here.
      const gst = actor.role === "OWNER" && input.gst ? input.gst : current;
      if (gst !== current) Object.assign(orderData, { cgst: gst.cgst, sgst: gst.sgst });
      if (orderGstPaise(gst) > 0) Object.assign(orderData, { gstPaidAt: new Date(), gstPaymentMethod: input.paymentMethod });
    }
    if (!stillPending) orderData.status = "RECEIVED";
    if (Object.keys(orderData).length) await tx.purchaseOrder.update({ where: { id: order.id }, data: orderData });

    const units = lines.reduce((n, l) => n + l.quantity, 0);
    await recordAudit(tx, {
      action: "ORDER_RECEIVED",
      entityType: "PurchaseOrder",
      entityId: order.id,
      summary: `Received ${units} unit${units === 1 ? "" : "s"} on ${order.orderNumber}${stillPending ? " (more pending)" : " (complete)"}: ${lines
        .map((l) => `${l.quantity}× ${l.item.name}`)
        .join(", ")}`,
      actorId: actor.id,
      metadata: { lines: lines.map((l) => ({ itemId: l.item.id, productId: l.item.productId, quantity: l.quantity })) },
    });
  });
  return (await getOrder(input.orderId))!;
}

/* ---------- Close ---------- */

/** Owner only. Stops waiting for whatever is still pending. Stock is not touched. */
export async function closeOrder(input: { orderId: string; reason: string }, actor: SessionUser): Promise<OrderDetailDTO> {
  requireOwner(actor, "close orders");
  await prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (order.status !== "ACTIVE") throw new AppError(`${order.orderNumber} is not active.`, "CONFLICT");
    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "CLOSED", closedById: actor.id, closedAt: new Date(), closeReason: input.reason },
    });
    await recordAudit(tx, {
      action: "ORDER_CLOSED",
      entityType: "PurchaseOrder",
      entityId: order.id,
      summary: `Closed ${order.orderNumber}: ${input.reason}`,
      actorId: actor.id,
    });
  });
  return (await getOrder(input.orderId))!;
}

/* ---------- Read ---------- */

export async function getOrder(id: string): Promise<OrderDetailDTO | null> {
  const [row, movements] = await Promise.all([
    prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude }),
    prisma.stockMovement.findMany({
      where: { purchaseOrderId: id },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true } }, performedBy: { select: { name: true } } },
    }),
  ]);
  if (!row) return null;
  return {
    ...toOrderDTO(row),
    receipts: movements.map((m) => ({
      id: m.id,
      productName: m.product.name,
      quantity: m.quantityChange,
      performedByName: m.performedBy.name,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export type ListOrdersParams = {
  statuses?: OrderStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listOrders(params: ListOrdersParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const where: Prisma.PurchaseOrderWhereInput = {};
  if (params.statuses?.length) where.status = { in: params.statuses };
  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { notes: { contains: search, mode: "insensitive" } },
      { items: { some: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, include: orderInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { items: rows.map(toOrderDTO), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function countActiveOrders(): Promise<number> {
  return prisma.purchaseOrder.count({ where: { status: "ACTIVE" } });
}

/** "On order" hint for a product page: active orders still waiting for this product. */
export async function getPendingOrdersForProduct(productId: string) {
  const rows = await prisma.purchaseOrderItem.findMany({
    where: { productId, purchaseOrder: { status: "ACTIVE" } },
    select: { quantityOrdered: true, quantityReceived: true, purchaseOrder: { select: { id: true, orderNumber: true } } },
    orderBy: { purchaseOrder: { createdAt: "asc" } },
  });
  return rows
    .map((r) => ({ orderId: r.purchaseOrder.id, orderNumber: r.purchaseOrder.orderNumber, pending: r.quantityOrdered - r.quantityReceived }))
    .filter((r) => r.pending > 0);
}

/* ---------- Money paid for orders ---------- */

export type PrepaidOrder = { id: string; orderNumber: string; paidAt: Date; paymentMethod: PaymentMethod; units: number; uncostedUnits: number; paise: number };

/**
 * Orders paid for when placed, in the window: what was paid for the products (every
 * ordered unit at its cost). Their GST is charged through gstPaidAt like any other order.
 */
export async function listPrepaidOrders(paidAt: Prisma.DateTimeNullableFilter<"PurchaseOrder">): Promise<PrepaidOrder[]> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { paidAt, paymentMethod: { not: null } },
    select: { id: true, orderNumber: true, paidAt: true, paymentMethod: true, items: { select: { quantityOrdered: true, unitCost: true } } },
  });
  return rows.map((o) => {
    let units = 0;
    let uncostedUnits = 0;
    let paise = 0;
    for (const i of o.items) {
      units += i.quantityOrdered;
      if (i.unitCost) paise += toPaise(i.unitCost.toString()) * i.quantityOrdered;
      else uncostedUnits += i.quantityOrdered;
    }
    return { id: o.id, orderNumber: o.orderNumber, paidAt: o.paidAt!, paymentMethod: o.paymentMethod!, units, uncostedUnits, paise };
  });
}

/* ---------- Purchase report ---------- */

export type PurchaseReportOrder = { orderId: string; orderNumber: string; paidOn: string; units: number; amount: string };

export type PurchaseReport = {
  /** Cost of everything received in the period (units x the order's unit cost), plus GST paid on those bills. */
  total: string;
  units: number;
  /** Units on lines with no cost typed, which the total can't include. */
  uncostedUnits: number;
  orders: PurchaseReportOrder[];
};

/**
 * Owner: money spent on products in the range. An order is counted on the day it was
 * placed and paid for; an older order paid on delivery counts what arrived, on the day
 * it was received.
 */
export async function getPurchaseReport(range: { from: Date; to: Date }): Promise<PurchaseReport> {
  const [rows, gstOrders, prepaid] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { type: "STOCK_IN", purchaseOrder: { paidAt: null }, createdAt: { gte: range.from, lte: range.to } },
      select: { quantityChange: true, unitCost: true, createdAt: true, purchaseOrder: { select: { id: true, orderNumber: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { gstPaidAt: { gte: range.from, lte: range.to } },
      select: { id: true, orderNumber: true, cgst: true, sgst: true, gstPaidAt: true },
    }),
    listPrepaidOrders({ gte: range.from, lte: range.to }),
  ]);
  const byOrder = new Map<string, { orderNumber: string; last: Date; units: number; paise: number }>();
  let total = 0;
  let units = 0;
  let uncostedUnits = 0;
  for (const r of rows) {
    const o = r.purchaseOrder!;
    const paise = r.unitCost ? toPaise(r.unitCost.toString()) * r.quantityChange : 0;
    if (!r.unitCost) uncostedUnits += r.quantityChange;
    total += paise;
    units += r.quantityChange;
    const cur = byOrder.get(o.id) ?? { orderNumber: o.orderNumber, last: r.createdAt, units: 0, paise: 0 };
    cur.units += r.quantityChange;
    cur.paise += paise;
    if (r.createdAt > cur.last) cur.last = r.createdAt;
    byOrder.set(o.id, cur);
  }
  for (const o of prepaid) {
    total += o.paise;
    units += o.units;
    uncostedUnits += o.uncostedUnits;
    byOrder.set(o.id, { orderNumber: o.orderNumber, last: o.paidAt, units: o.units, paise: o.paise });
  }
  for (const o of gstOrders) {
    const paise = orderGstPaise(o);
    total += paise;
    const cur = byOrder.get(o.id) ?? { orderNumber: o.orderNumber, last: o.gstPaidAt!, units: 0, paise: 0 };
    cur.paise += paise;
    byOrder.set(o.id, cur);
  }
  const orders = [...byOrder.entries()]
    .map(([orderId, o]) => ({ orderId, orderNumber: o.orderNumber, paidOn: o.last.toISOString(), units: o.units, amount: fromPaise(o.paise) }))
    .sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1));
  return { total: fromPaise(total), units, uncostedUnits, orders };
}
