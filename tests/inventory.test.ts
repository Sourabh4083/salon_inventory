import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { adjustStock, getDashboardStats, listMovements, recordSale, recordStockIn } from "@/lib/services/inventory";
import { updateSettings } from "@/lib/services/settings";
import { productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

async function make(name: string, startingQuantity: number) {
  return createProduct(productCreateSchema.parse({ name, categoryId, startingQuantity }), owner);
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("add stock", () => {
  it("increases quantity and records STOCK_IN with previous/new values and the user", async () => {
    const p = await make("Italian Glue", 2);
    const { product, movement } = await recordStockIn({ productId: p.id, quantity: 10, unitCost: "500", note: "New delivery" }, owner);
    expect(product.quantity).toBe(12);
    expect(product.stockStatus).toBe("IN_STOCK");
    expect(movement).toMatchObject({ type: "STOCK_IN", quantityChange: 10, previousQuantity: 2, newQuantity: 12, unitCost: "500", note: "New delivery", performedByName: owner.name });
  });

  it("rejects zero or negative quantities", async () => {
    const p = await make("Scalp Protector", 2);
    await expect(recordStockIn({ productId: p.id, quantity: 0 }, owner)).rejects.toThrow();
    await expect(recordStockIn({ productId: p.id, quantity: -3 }, owner)).rejects.toThrow();
  });
});

describe("sell", () => {
  it("reduces quantity, records SALE, and status becomes LOW_STOCK at 4", async () => {
    const p = await make("Lacehold", 5);
    const { product, movement } = await recordSale({ productId: p.id, quantity: 1 }, manager);
    expect(product.quantity).toBe(4);
    expect(product.stockStatus).toBe("LOW_STOCK");
    expect(movement).toMatchObject({ type: "SALE", quantityChange: -1, previousQuantity: 5, newQuantity: 4, performedByName: manager.name });
  });

  it("rejects selling more than available and leaves stock untouched", async () => {
    const p = await make("C-22 Gallon", 2);
    await expect(recordSale({ productId: p.id, quantity: 3 }, manager)).rejects.toThrow("Only 2 units are currently available.");
    expect((await getProduct(p.id))?.quantity).toBe(2);
    expect(await prisma.stockMovement.count({ where: { productId: p.id, type: "SALE" } })).toBe(0);
  });

  it("stock can reach exactly zero (OUT_OF_STOCK) but never negative", async () => {
    const p = await make("Cut Piece", 1);
    const r = await recordSale({ productId: p.id, quantity: 1 }, manager);
    expect(r.product.quantity).toBe(0);
    expect(r.product.stockStatus).toBe("OUT_OF_STOCK");
    await expect(recordSale({ productId: p.id, quantity: 1 }, manager)).rejects.toThrow(/out of stock/i);
    expect((await getProduct(p.id))?.quantity).toBe(0);
  });
});

describe("adjust", () => {
  it("records the difference as ADJUSTMENT with the reason", async () => {
    const p = await make("Small Softener C-1", 10);
    const { product, movement } = await adjustStock({ productId: p.id, newQuantity: 8, reason: "Physical count correction" }, owner);
    expect(product.quantity).toBe(8);
    expect(movement).toMatchObject({ type: "ADJUSTMENT", quantityChange: -2, previousQuantity: 10, newQuantity: 8, note: "Physical count correction" });
  });

  it("refuses a no-op adjustment and negative quantities", async () => {
    const p = await make("Divine 7 Yard White", 4);
    await expect(adjustStock({ productId: p.id, newQuantity: 4, reason: "same" }, owner)).rejects.toThrow(/already/i);
    await expect(adjustStock({ productId: p.id, newQuantity: -1, reason: "bad" }, owner)).rejects.toThrow();
  });
});

describe("ledger", () => {
  it("every inventory update creates exactly one StockMovement and history is ordered newest first", async () => {
    const p = await make("Blue 36 Yard", 1);
    await recordStockIn({ productId: p.id, quantity: 5 }, owner);
    await recordSale({ productId: p.id, quantity: 2 }, manager);
    await adjustStock({ productId: p.id, newQuantity: 3, reason: "count" }, owner);

    const history = await listMovements({ productId: p.id });
    expect(history.total).toBe(4);
    expect(history.items.map((m) => m.type)).toEqual(["ADJUSTMENT", "SALE", "STOCK_IN", "INITIAL_STOCK"]);
    // chain is consistent
    expect(history.items[0].previousQuantity).toBe(history.items[1].newQuantity);
    expect(history.items[1].previousQuantity).toBe(history.items[2].newQuantity);
    expect((await getProduct(p.id))?.quantity).toBe(3);
  });
});

describe("dashboard + settings", () => {
  it("counts low/out of stock using the shop-wide threshold, and reacts when the owner changes it", async () => {
    const before = await getDashboardStats();
    expect(before.totalProducts).toBeGreaterThan(0);
    const products = await prisma.product.findMany({ where: { status: "ACTIVE" } });
    const expectLow = products.filter((p) => p.quantity >= 1 && p.quantity <= 4).length;
    const expectOut = products.filter((p) => p.quantity === 0).length;
    expect(before.lowStockCount).toBe(expectLow);
    expect(before.outOfStockCount).toBe(expectOut);
    expect(before.totalUnits).toBe(products.reduce((s, p) => s + p.quantity, 0));

    await updateSettings({ businessName: "Test Salon", currencyCode: "INR", currencySymbol: "₹", lowStockThreshold: 10 }, owner.id);
    const after = await getDashboardStats();
    expect(after.lowStockCount).toBe(products.filter((p) => p.quantity >= 1 && p.quantity <= 10).length);
    expect((await getProduct((await make("Threshold Probe", 8)).id))?.stockStatus).toBe("LOW_STOCK");

    await updateSettings({ businessName: "Test Salon", currencyCode: "INR", currencySymbol: "₹", lowStockThreshold: 4 }, owner.id);
  });
});
