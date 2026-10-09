import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, Role } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { applyChange, lockProduct } from "@/lib/services/inventory";
import { fromPaise, toPaise } from "@/lib/money";
import { PAGE_SIZE } from "@/lib/constants";
import type { OrderCreateData, OrderReceiveData } from "@/lib/validation/schemas";

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
  /** Owner-only; null for managers or when no line has a cost. */
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
    totalCost: hasCost ? fromPaise(cost) : null,
    receivableLines,
  };
}

/** Costs are owner-only, same rule as productForViewer. */
export function orderForViewer<T extends OrderDTO>(dto: T, role: Role): T {
  if (role === "OWNER") return dto;
  return { ...dto, totalCost: null, items: dto.items.map((i) => ({ ...i, unitCost: null })) };
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
 * Places the order; stock does not change until products are received. Costs are
 * owner-only: a manager's order takes each product's saved cost price instead.
 */
export async function createOrder(data: OrderCreateData, actor: SessionUser): Promise<OrderDetailDTO> {
  const items = actor.role === "OWNER" ? data.items : data.items.map((i) => ({ ...i, unitCost: null }));
  const orderId = await prisma.$transaction(async (tx) => {
    const lines = await buildLines(tx, items);
    const order = await tx.purchaseOrder.create({
      data: {
        orderNumber: await nextOrderNumber(tx),
        notes: data.notes,
        createdById: actor.id,
        items: { createMany: { data: lines } },
      },
    });
    const units = lines.reduce((n, l) => n + l.quantityOrdered, 0);
    await recordAudit(tx, {
      action: "ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: order.id,
      summary: `Placed ${order.orderNumber}: ${lines.length} product${lines.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}`,
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
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: orderId } });
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { notes: data.notes, items: { createMany: { data: lines } } },
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
        paymentMethod: input.paymentMethod,
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
    if (!stillPending) await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: "RECEIVED" } });

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

/* ---------- Purchase report ---------- */

export type PurchaseReportOrder = { orderId: string; orderNumber: string; lastReceivedAt: string; units: number; amount: string };

export type PurchaseReport = {
  /** Cost of everything received in the period (units x the order's unit cost). */
  total: string;
  units: number;
  /** Units received on lines with no cost typed, which the total can't include. */
  uncostedUnits: number;
  orders: PurchaseReportOrder[];
};

/**
 * Owner: money spent on products that arrived in the range, counted on the day they
 * were received (so a short or closed order only counts what came in).
 */
export async function getPurchaseReport(range: { from: Date; to: Date }): Promise<PurchaseReport> {
  const rows = await prisma.stockMovement.findMany({
    where: { type: "STOCK_IN", purchaseOrderId: { not: null }, createdAt: { gte: range.from, lte: range.to } },
    select: { quantityChange: true, unitCost: true, createdAt: true, purchaseOrder: { select: { id: true, orderNumber: true } } },
  });
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
  const orders = [...byOrder.entries()]
    .map(([orderId, o]) => ({ orderId, orderNumber: o.orderNumber, lastReceivedAt: o.last.toISOString(), units: o.units, amount: fromPaise(o.paise) }))
    .sort((a, b) => (a.lastReceivedAt < b.lastReceivedAt ? 1 : -1));
  return { total: fromPaise(total), units, uncostedUnits, orders };
}
