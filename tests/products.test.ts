import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, updateProduct, listProducts, findProductByCode, setProductStatus, getProduct, deleteProduct, productForViewer, movementForViewer, updateProductPrices, getPricingSummary } from "@/lib/services/products";
import { computeMargin } from "@/lib/money";
import { productPricesSchema } from "@/lib/validation/schemas";
import { recordSale } from "@/lib/services/inventory";
import { productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

function input(overrides: Record<string, unknown>) {
  return productCreateSchema.parse({ name: "X", categoryId, startingQuantity: 0, ...overrides });
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("create product", () => {
  it("owner creates a product with a generated number and INITIAL_STOCK movement", async () => {
    const p = await createProduct(input({ name: "Italian Glue", sellingPrice: "600", barcode: "8901234567890", sku: "GLU-ITL", startingQuantity: 10 }), owner);
    expect(p.productNumber).toMatch(/^PRD-\d{6}$/);
    expect(p.quantity).toBe(10);
    expect(p.sellingPrice).toBe("600");
    expect(p.stockStatus).toBe("IN_STOCK");

    const movements = await prisma.stockMovement.findMany({ where: { productId: p.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: "INITIAL_STOCK", quantityChange: 10, previousQuantity: 0, newQuantity: 10, performedById: owner.id });

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_CREATED", entityId: p.id } });
    expect(audit?.actorId).toBe(owner.id);
  });

  it("does not create a movement when starting quantity is 0", async () => {
    const p = await createProduct(input({ name: "Tic Tac", startingQuantity: 0 }), owner);
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(0);
    expect(p.stockStatus).toBe("OUT_OF_STOCK");
  });

  it("product numbers increase sequentially", async () => {
    const a = await createProduct(input({ name: "Seq A" }), owner);
    const b = await createProduct(input({ name: "Seq B" }), owner);
    expect(Number(b.productNumber.slice(4))).toBe(Number(a.productNumber.slice(4)) + 1);
  });

  it("rejects duplicate barcode and SKU with a friendly message", async () => {
    await expect(createProduct(input({ name: "Dup barcode", barcode: "8901234567890" }), owner)).rejects.toThrow(/barcode is already used/i);
    await expect(createProduct(input({ name: "Dup sku", sku: "glu-itl" }), owner)).rejects.toThrow(/already/i);
  });

  it("validation: money accepts '1,200.50' and rejects garbage; blanks become null", () => {
    const ok = productCreateSchema.parse({ name: " Lacehold ", categoryId, startingQuantity: "2", sellingPrice: "1,200.50", sku: "", barcode: "  " });
    expect(ok.name).toBe("Lacehold");
    expect(ok.sellingPrice).toBe("1200.50");
    expect(ok.sku).toBeNull();
    expect(ok.barcode).toBeNull();
    expect(ok.startingQuantity).toBe(2);
    expect(() => productCreateSchema.parse({ name: "X", categoryId, startingQuantity: 1, sellingPrice: "abc" })).toThrow();
    expect(() => productCreateSchema.parse({ name: "X", categoryId, startingQuantity: -1 })).toThrow();
  });
});

describe("edit product", () => {
  it("manager can edit basic fields but not prices or the low-stock override", async () => {
    const p = await createProduct(input({ name: "Ultrahold", sellingPrice: "2100", costPrice: "1500", startingQuantity: 1 }), owner);
    const updated = await updateProduct(
      p.id,
      { ...input({ name: "Ultrahold 1.4oz", sellingPrice: "2200", costPrice: "1", lowStockThreshold: 10 }), unit: "BOTTLE" },
      manager,
    );
    expect(updated.name).toBe("Ultrahold 1.4oz");
    expect(updated.sellingPrice).toBe("2100"); // manager price change ignored
    expect(updated.costPrice).toBe("1500");
    expect(updated.unit).toBe("BOTTLE");
    expect(updated.lowStockThreshold).toBeNull(); // manager change ignored
    expect(updated.quantity).toBe(1); // quantity never changes through edit
    expect(updated.updatedByName).toBe(manager.name);
  });

  it("manager-created products have no prices; owner sets them later", async () => {
    const p = await createProduct(input({ name: "Manager Tape", sellingPrice: "300", costPrice: "200", startingQuantity: 2 }), manager);
    expect(p.sellingPrice).toBeNull();
    expect(p.costPrice).toBeNull();
    const priced = await updateProductPrices(p.id, productPricesSchema.parse({ costPrice: "200", sellingPrice: "300" }), owner);
    expect(priced.costPrice).toBe("200");
    expect(priced.sellingPrice).toBe("300");
    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_UPDATED", entityId: p.id }, orderBy: { createdAt: "desc" } });
    expect(audit?.summary).toMatch(/Changed prices/);
  });

  it("only the owner can change prices from the pricing page", async () => {
    const p = await createProduct(input({ name: "Owner Only Price", sellingPrice: "100", costPrice: "50" }), owner);
    await expect(updateProductPrices(p.id, productPricesSchema.parse({ costPrice: "1", sellingPrice: "2" }), manager)).rejects.toThrow(/owner/i);
    expect((await getProduct(p.id))?.costPrice).toBe("50");
  });

  it("cost price is redacted for managers but kept for the owner", async () => {
    const p = await createProduct(input({ name: "Redacted", sellingPrice: "100", costPrice: "60", startingQuantity: 1 }), owner);
    expect(productForViewer(p, "MANAGER").costPrice).toBeNull();
    expect(productForViewer(p, "MANAGER").sellingPrice).toBe("100");
    expect(productForViewer(p, "OWNER").costPrice).toBe("60");
    const movement = (await prisma.stockMovement.findFirstOrThrow({ where: { productId: p.id }, include: { product: { select: { name: true, productNumber: true } }, performedBy: { select: { name: true, role: true } } } }));
    const { toMovementDTO } = await import("@/lib/services/products");
    const dto = toMovementDTO(movement);
    expect(dto.unitCost).toBe("60");
    expect(movementForViewer(dto, "MANAGER").unitCost).toBeNull();
    expect(movementForViewer(dto, "OWNER").unitCost).toBe("60");
  });

  it("computes profit and margins", () => {
    expect(computeMargin("450", "600")).toEqual({ profit: "150.00", marginPct: 25, markupPct: 33.3 });
    expect(computeMargin("600", "450").profit).toBe("-150.00");
    expect(computeMargin(null, "600")).toEqual({ profit: null, marginPct: null, markupPct: null });
    expect(computeMargin("100", "0")).toEqual({ profit: "-100.00", marginPct: null, markupPct: -100 });
  });

  it("pricing summary totals stock at cost and selling price", async () => {
    const s = await getPricingSummary();
    expect(s.products).toBeGreaterThan(0);
    expect(Number(s.stockAtSelling) - Number(s.stockAtCost)).toBeCloseTo(Number(s.potentialProfit), 2);
    expect(s.missingCost).toBeGreaterThanOrEqual(0);
  });

  it("owner can set the low-stock override", async () => {
    const p = await createProduct(input({ name: "Softener", startingQuantity: 6 }), owner);
    const updated = await updateProduct(p.id, input({ name: "Softener", lowStockThreshold: 8 }), owner);
    expect(updated.lowStockThreshold).toBe(8);
    expect(updated.stockStatus).toBe("LOW_STOCK"); // 6 <= 8
  });
});

describe("search", () => {
  beforeAll(async () => {
    await createProduct(input({ name: "Johnson White", sku: "TP-JW", barcode: "111111111111", startingQuantity: 2 }), owner);
    await createProduct(input({ name: "Johnson Yellow 20 Yard", startingQuantity: 4 }), owner);
    await createProduct(input({ name: "Johnson Red", startingQuantity: 2 }), owner);
  });

  it("finds by full name (case-insensitive)", async () => {
    const r = await listProducts({ search: "italian glue" });
    expect(r.items.map((p) => p.name)).toEqual(["Italian Glue"]);
  });

  it("finds by partial name", async () => {
    const r = await listProducts({ search: "johnson" });
    expect(r.items.map((p) => p.name).sort()).toEqual(["Johnson Red", "Johnson White", "Johnson Yellow 20 Yard"]);
  });

  it("finds by SKU", async () => {
    const r = await listProducts({ search: "tp-jw" });
    expect(r.items[0].name).toBe("Johnson White");
  });

  it("finds by barcode and exact code lookup returns the product", async () => {
    const r = await listProducts({ search: "111111111111" });
    expect(r.items[0].name).toBe("Johnson White");
    expect((await findProductByCode("111111111111"))?.name).toBe("Johnson White");
    expect((await findProductByCode("TP-JW"))?.name).toBe("Johnson White");
    expect(await findProductByCode("000000000000")).toBeNull();
  });

  it("filters by stock status using the shop threshold", async () => {
    const low = await listProducts({ stockStatus: "LOW_STOCK" });
    expect(low.items.every((p) => p.quantity >= 1 && p.quantity <= p.effectiveThreshold)).toBe(true);
    expect(low.items.map((p) => p.name)).toEqual(expect.arrayContaining(["Johnson Yellow 20 Yard", "Johnson Red"]));
    const out = await listProducts({ stockStatus: "OUT_OF_STOCK" });
    expect(out.items.map((p) => p.name)).toContain("Tic Tac");
  });
});

describe("archive", () => {
  it("archived product disappears from the list but keeps its movements", async () => {
    const p = await createProduct(input({ name: "Yellow Tape Local", startingQuantity: 3 }), owner);
    await recordSale({ productId: p.id, quantity: 1 }, manager);
    await setProductStatus(p.id, "ARCHIVED", owner);

    const listed = await listProducts({ search: "Yellow Tape Local" });
    expect(listed.items).toHaveLength(0);

    const archived = await listProducts({ search: "Yellow Tape Local", archivedOnly: true });
    expect(archived.items).toHaveLength(1);

    const movements = await prisma.stockMovement.findMany({ where: { productId: p.id } });
    expect(movements.map((m) => m.type).sort()).toEqual(["INITIAL_STOCK", "SALE"]);
    expect((await getProduct(p.id))?.status).toBe("ARCHIVED");

    await expect(recordSale({ productId: p.id, quantity: 1 }, manager)).rejects.toThrow(/archived/i);
  });
});

describe("delete", () => {
  it("owner permanently deletes a product with its movements and leaves an audit record", async () => {
    const p = await createProduct(input({ name: "Disposable Razor Delete Me", startingQuantity: 5, barcode: "8900000000099" }), owner);
    await recordSale({ productId: p.id, quantity: 2 }, manager);

    const result = await deleteProduct(p.id, owner);
    expect(result.productNumber).toBe(p.productNumber);

    expect(await getProduct(p.id)).toBeNull();
    expect(await prisma.stockMovement.count({ where: { productId: p.id } })).toBe(0);
    expect(await findProductByCode("8900000000099")).toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_DELETED", entityId: p.id } });
    expect(audit?.summary).toContain(p.productNumber);
    expect((audit?.metadata as { movementCount: number }).movementCount).toBe(2);
  });

  it("manager cannot delete a product", async () => {
    const p = await createProduct(input({ name: "Keep Me Manager Test", startingQuantity: 1 }), owner);
    await expect(deleteProduct(p.id, manager)).rejects.toThrow(/owner/i);
    expect(await getProduct(p.id)).not.toBeNull();
  });

  it("deleting a missing product fails cleanly", async () => {
    await expect(deleteProduct("does-not-exist", owner)).rejects.toThrow(/not found/i);
  });
});
