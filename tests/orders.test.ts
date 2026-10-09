import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, deleteProduct, getProduct } from "@/lib/services/products";
import { closeOrder, createOrder, getOrder, getPendingOrdersForProduct, getPurchaseReport, listOrders, orderForViewer, receiveOrder, updateOrder } from "@/lib/services/orders";
import { orderCreateSchema, orderReceiveSchema, productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

function product(name: string, overrides: Record<string, unknown> = {}) {
  return createProduct(productCreateSchema.parse({ name, categoryId, startingQuantity: 0, ...overrides }), owner);
}

function order(items: { productId: string; quantity: number; unitCost?: string }[], notes?: string) {
  return orderCreateSchema.parse({ items, notes });
}

function receive(orderId: string, lines: "ALL" | { itemId: string; quantity: number }[]) {
  return orderReceiveSchema.parse({ orderId, lines });
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("placing an order", () => {
  it("creates an ACTIVE numbered order without touching stock", async () => {
    const glue = await product("Order Glue", { startingQuantity: 2, costPrice: "400" });
    const tape = await product("Order Tape");
    const o = await createOrder(order([{ productId: glue.id, quantity: 10 }, { productId: tape.id, quantity: 5, unitCost: "80" }], "Ravi Traders"), owner);

    expect(o.orderNumber).toBe("ORD-000001");
    expect(o.status).toBe("ACTIVE");
    expect(o.notes).toBe("Ravi Traders");
    expect(o.totalOrdered).toBe(15);
    expect(o.totalPending).toBe(15);
    // Cost defaults to the product's cost price when none is typed.
    expect(o.items.map((i) => [i.name, i.unitCost])).toEqual([
      ["Order Glue", "400.00"],
      ["Order Tape", "80.00"],
    ]);
    expect(o.totalCost).toBe("4400.00");
    expect((await getProduct(glue.id))?.quantity).toBe(2);
    expect(await prisma.stockMovement.count({ where: { purchaseOrderId: o.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "ORDER_CREATED", entityId: o.id } })).toBe(1);
  });

  it("merges duplicate products into one line", async () => {
    const p = await product("Dup Line");
    const o = await createOrder(order([{ productId: p.id, quantity: 2 }, { productId: p.id, quantity: 3 }]), owner);
    expect(o.items).toHaveLength(1);
    expect(o.items[0].quantityOrdered).toBe(5);
  });

  it("a manager can place an order, but a cost they type is ignored", async () => {
    const p = await product("Manager Order", { costPrice: "90" });
    const o = await createOrder(order([{ productId: p.id, quantity: 2, unitCost: "1" }]), manager);
    expect(o.status).toBe("ACTIVE");
    // The line carries the owner's saved cost price, and the manager never gets it back.
    expect(o.items[0].unitCost).toBe("90.00");
    expect(orderForViewer(o, "MANAGER").items[0].unitCost).toBeNull();
    await expect(updateOrder(o.id, order([{ productId: p.id, quantity: 5 }]), manager)).rejects.toThrow(/owner/i);
  });

  it("refuses archived products", async () => {
    const p = await product("Archived Order");
    await prisma.product.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
    await expect(createOrder(order([{ productId: p.id, quantity: 1 }]), owner)).rejects.toThrow(/archived/i);
  });
});

describe("receiving", () => {
  it("Received (ALL) adds every product to stock, links movements, updates cost and completes the order", async () => {
    const a = await product("Recv A", { startingQuantity: 1, costPrice: "100" });
    const b = await product("Recv B", { startingQuantity: 0 });
    const o = await createOrder(order([{ productId: a.id, quantity: 4, unitCost: "120" }, { productId: b.id, quantity: 6, unitCost: "50" }]), owner);

    const done = await receiveOrder(receive(o.id, "ALL"), manager);
    expect(done.status).toBe("RECEIVED");
    expect(done.totalPending).toBe(0);
    expect(done.receipts).toHaveLength(2);

    const pa = await getProduct(a.id);
    expect(pa?.quantity).toBe(5);
    expect(pa?.costPrice).toBe("120");
    expect((await getProduct(b.id))?.quantity).toBe(6);

    const movements = await prisma.stockMovement.findMany({ where: { purchaseOrderId: o.id }, orderBy: { productId: "asc" } });
    expect(movements.every((m) => m.type === "STOCK_IN" && m.performedById === manager.id)).toBe(true);
    expect(movements.map((m) => m.note)).toEqual([`Received on ${o.orderNumber}`, `Received on ${o.orderNumber}`]);

    await expect(receiveOrder(receive(o.id, "ALL"), owner)).rejects.toThrow(/already been fully received/);
  });

  it("a short delivery keeps the order ACTIVE with the rest pending, and a later receipt completes it", async () => {
    const a = await product("Short A");
    const b = await product("Short B");
    const o = await createOrder(order([{ productId: a.id, quantity: 10 }, { productId: b.id, quantity: 3 }]), owner);
    const [ia, ib] = o.items;

    const partial = await receiveOrder(receive(o.id, [{ itemId: ia.id, quantity: 6 }, { itemId: ib.id, quantity: 0 }]), manager);
    expect(partial.status).toBe("ACTIVE");
    expect(partial.items.map((i) => [i.quantityReceived, i.pending])).toEqual([
      [6, 4],
      [0, 3],
    ]);
    expect((await getProduct(a.id))?.quantity).toBe(6);
    expect((await getProduct(b.id))?.quantity).toBe(0);
    expect(await getPendingOrdersForProduct(a.id)).toEqual([{ orderId: o.id, orderNumber: o.orderNumber, pending: 4 }]);

    const rest = await receiveOrder(receive(o.id, "ALL"), manager);
    expect(rest.status).toBe("RECEIVED");
    expect((await getProduct(a.id))?.quantity).toBe(10);
    expect((await getProduct(b.id))?.quantity).toBe(3);
    expect(await getPendingOrdersForProduct(a.id)).toEqual([]);
  });

  it("rejects receiving more than is pending, or nothing at all", async () => {
    const p = await product("Over Recv");
    const o = await createOrder(order([{ productId: p.id, quantity: 2 }]), owner);
    await expect(receiveOrder(receive(o.id, [{ itemId: o.items[0].id, quantity: 3 }]), manager)).rejects.toThrow(/Only 2 of "Over Recv"/);
    await expect(receiveOrder(receive(o.id, [{ itemId: o.items[0].id, quantity: 0 }]), manager)).rejects.toThrow(/Nothing to receive/);
    expect((await getProduct(p.id))?.quantity).toBe(0);
  });

  it("a line ordered without a cost is received at the cost price set since", async () => {
    // A brand-new product added by the manager while ordering has no prices yet.
    const fresh = await createProduct(productCreateSchema.parse({ name: "Brand New", categoryId, startingQuantity: 0 }), manager);
    const o = await createOrder(order([{ productId: fresh.id, quantity: 3 }]), manager);
    expect(o.items[0].unitCost).toBeNull();

    await prisma.product.update({ where: { id: fresh.id }, data: { costPrice: "250" } });
    await receiveOrder(receive(o.id, "ALL"), manager);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { purchaseOrderId: o.id } });
    expect(movement.unitCost?.toFixed(2)).toBe("250.00");
    expect((await getProduct(fresh.id))?.quantity).toBe(3);
  });

  it("skips a product deleted after ordering, and it doesn't hold the order open", async () => {
    const keep = await product("Keep Me");
    const gone = await product("Delete Me");
    const o = await createOrder(order([{ productId: keep.id, quantity: 2 }, { productId: gone.id, quantity: 2 }]), owner);
    await deleteProduct(gone.id, owner);

    const after = await receiveOrder(receive(o.id, "ALL"), manager);
    expect(after.status).toBe("RECEIVED");
    expect(after.items.find((i) => i.name === "Delete Me")?.productId).toBeNull();
    expect((await getProduct(keep.id))?.quantity).toBe(2);
  });
});

describe("closing and editing", () => {
  it("owner closes an order with products still pending; stock is untouched", async () => {
    const p = await product("Close Me");
    const o = await createOrder(order([{ productId: p.id, quantity: 5 }]), owner);
    await receiveOrder(receive(o.id, [{ itemId: o.items[0].id, quantity: 2 }]), manager);

    await expect(closeOrder({ orderId: o.id, reason: "Out at the shop" }, manager)).rejects.toThrow(/owner/i);
    const closed = await closeOrder({ orderId: o.id, reason: "Out at the shop" }, owner);
    expect(closed.status).toBe("CLOSED");
    expect(closed.totalPending).toBe(3);
    expect(closed.closeReason).toBe("Out at the shop");
    expect((await getProduct(p.id))?.quantity).toBe(2);
    await expect(receiveOrder(receive(o.id, "ALL"), owner)).rejects.toThrow(/closed/);
  });

  it("an order can be edited only until something is received", async () => {
    const a = await product("Edit A");
    const b = await product("Edit B");
    const o = await createOrder(order([{ productId: a.id, quantity: 1 }]), owner);

    const edited = await updateOrder(o.id, order([{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 2 }], "changed"), owner);
    expect(edited.items.map((i) => [i.name, i.quantityOrdered])).toEqual([
      ["Edit A", 3],
      ["Edit B", 2],
    ]);
    expect(edited.notes).toBe("changed");

    await receiveOrder(receive(edited.id, [{ itemId: edited.items[0].id, quantity: 1 }]), manager);
    await expect(updateOrder(o.id, order([{ productId: a.id, quantity: 9 }]), owner)).rejects.toThrow(/already been received/);
  });
});

describe("reading", () => {
  it("hides costs from managers", async () => {
    const p = await product("Cost Hidden", { costPrice: "70" });
    const o = await createOrder(order([{ productId: p.id, quantity: 1 }]), owner);
    const full = (await getOrder(o.id))!;
    expect(full.items[0].unitCost).toBe("70.00");
    const forManager = orderForViewer(full, "MANAGER");
    expect(forManager.totalCost).toBeNull();
    expect(forManager.items[0].unitCost).toBeNull();
    expect(forManager.receipts).toEqual(full.receipts);
  });

  it("lists active orders separately from history and searches by product name", async () => {
    const active = await listOrders({ statuses: ["ACTIVE"], pageSize: 100 });
    expect(active.items.every((o) => o.status === "ACTIVE")).toBe(true);
    const history = await listOrders({ statuses: ["RECEIVED", "CLOSED"], pageSize: 100 });
    expect(history.items.some((o) => o.status === "CLOSED")).toBe(true);
    const found = await listOrders({ search: "close me" });
    expect(found.items.map((o) => o.items[0].name)).toEqual(["Close Me"]);
  });
});

describe("purchase report", () => {
  it("adds up what arrived in the period at the order's cost, per order", async () => {
    const start = new Date();
    const costed = await product("Spend Costed", { costPrice: "100" });
    const typed = await product("Spend Typed");
    const free = await product("Spend No Cost");
    const o = await createOrder(
      order([
        { productId: costed.id, quantity: 5 },
        { productId: typed.id, quantity: 4, unitCost: "120" },
        { productId: free.id, quantity: 3 },
      ]),
      owner,
    );
    await receiveOrder(receive(o.id, [{ itemId: o.items[0].id, quantity: 5 }, { itemId: o.items[1].id, quantity: 2 }, { itemId: o.items[2].id, quantity: 3 }]), manager);
    // What was never received doesn't count once the order is closed.
    await closeOrder({ orderId: o.id, reason: "Rest not coming" }, owner);

    const report = await getPurchaseReport({ from: start, to: new Date() });
    expect(report.total).toBe("740.00");
    expect(report.units).toBe(10);
    expect(report.uncostedUnits).toBe(3);
    expect(report.orders).toEqual([expect.objectContaining({ orderId: o.id, orderNumber: o.orderNumber, units: 10, amount: "740.00" })]);

    const before = await getPurchaseReport({ from: new Date(start.getTime() - 60_000), to: new Date(start.getTime() - 1) });
    expect(before.orders.map((x) => x.orderId)).not.toContain(o.id);
  });
});
