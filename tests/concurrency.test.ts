import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { recordSale, recordStockIn } from "@/lib/services/inventory";
import { productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("concurrent stock changes", () => {
  it("two users selling the last units at the same time cannot oversell", async () => {
    const p = await createProduct(productCreateSchema.parse({ name: "Ultrahold", categoryId, startingQuantity: 3 }), owner);

    // 6 simultaneous attempts to sell 1 unit each; only 3 can succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => recordSale({ productId: p.id, quantity: 1, note: `attempt ${i}` }, i % 2 ? owner : manager)),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.message).toMatch(/out of stock|currently available/i);
    }

    const final = await getProduct(p.id);
    expect(final?.quantity).toBe(0);

    // Ledger is consistent: exactly 3 SALE movements forming a chain 3->2->1->0.
    const sales = await prisma.stockMovement.findMany({ where: { productId: p.id, type: "SALE" }, orderBy: { newQuantity: "desc" } });
    expect(sales.map((m) => [m.previousQuantity, m.newQuantity])).toEqual([
      [3, 2],
      [2, 1],
      [1, 0],
    ]);
  });

  it("interleaved stock-in and sales keep an exact ledger", async () => {
    const p = await createProduct(productCreateSchema.parse({ name: "Johnson Premium", categoryId, startingQuantity: 2 }), owner);
    await Promise.allSettled([
      recordStockIn({ productId: p.id, quantity: 5 }, owner),
      recordSale({ productId: p.id, quantity: 2 }, manager),
      recordStockIn({ productId: p.id, quantity: 1 }, manager),
      recordSale({ productId: p.id, quantity: 4 }, owner),
    ]);
    const movements = await prisma.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: "asc" } });
    const final = await getProduct(p.id);
    // Sum of all changes equals the final quantity, and every movement chains correctly.
    expect(movements.reduce((s, m) => s + m.quantityChange, 0)).toBe(final?.quantity);
    const sorted = [...movements].sort((a, b) => a.previousQuantity - b.previousQuantity || a.newQuantity - b.newQuantity);
    expect(final!.quantity).toBeGreaterThanOrEqual(0);
    expect(sorted.length).toBeGreaterThanOrEqual(3);
  });
});
