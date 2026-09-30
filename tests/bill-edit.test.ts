import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { billForViewer, cancelBill, createBill, getBill, getOriginalBillSummary, getSalesReport, updateBill } from "@/lib/services/billing";
import { addDaysInZone, startOfDayInZone, endOfDayInZone, zonedParts } from "@/lib/timezone";
import { billCreateSchema, billUpdateSchema, productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

function productInput(overrides: Record<string, unknown>) {
  return productCreateSchema.parse({ name: "X", categoryId, startingQuantity: 0, ...overrides });
}

/** "2026-09-27T18:30" in the salon's zone for an instant. */
function localInput(d: Date) {
  const p = zonedParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("owner edits a bill", () => {
  let glueId = "";
  let tapeId = "";
  let combId = "";
  let billId = "";

  beforeAll(async () => {
    glueId = (await createProduct(productInput({ name: "Edit Glue", sellingPrice: "600", costPrice: "400", startingQuantity: 10 }), owner)).id;
    tapeId = (await createProduct(productInput({ name: "Edit Tape", sellingPrice: "100", costPrice: "60", startingQuantity: 5 }), owner)).id;
    combId = (await createProduct(productInput({ name: "Edit Comb", sellingPrice: "50", costPrice: "20", startingQuantity: 2 }), owner)).id;
    const bill = await createBill(
      billCreateSchema.parse({
        items: [
          { kind: "PRODUCT", productId: glueId, quantity: 2, unitPrice: "600" },
          { kind: "PRODUCT", productId: tapeId, quantity: 1, unitPrice: "100" },
          { kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "300" },
        ],
        paymentMethod: "CASH",
      }),
      manager,
    );
    billId = bill.id;
    expect((await getProduct(glueId))?.quantity).toBe(8);
    expect((await getProduct(tapeId))?.quantity).toBe(4);
  });

  it("changes quantities, removes and adds lines, and stock follows each change", async () => {
    const bill = (await getBill(billId))!;
    const updated = await updateBill(
      billUpdateSchema.parse({
        billId,
        billedAt: localInput(new Date(bill.createdAt)),
        items: [
          { kind: "PRODUCT", productId: glueId, quantity: 3, unitPrice: "550" }, // +1 sold, new price
          // tape removed: 1 back on the shelf
          { kind: "PRODUCT", productId: combId, quantity: 2, unitPrice: "50" }, // new line
          { kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "300" },
        ],
        discount: "100",
        paymentMethod: "UPI",
        customerName: "Asha",
      }),
      owner,
    );
    expect(updated.subtotal).toBe("2050.00");
    expect(updated.total).toBe("1950.00");
    expect(updated.paymentMethod).toBe("UPI");
    expect(updated.customerName).toBe("Asha");
    expect(updated.editedAt).not.toBeNull();
    expect(updated.editedByName).toBe(owner.name);

    expect((await getProduct(glueId))?.quantity).toBe(7);
    expect((await getProduct(tapeId))?.quantity).toBe(5);
    expect((await getProduct(combId))?.quantity).toBe(0);

    const edits = await prisma.stockMovement.findMany({ where: { billId, type: "BILL_EDITED" } });
    expect(edits).toHaveLength(3);
    // The glue line keeps the cost from the original sale; the comb takes today's cost.
    const lines = await prisma.billItem.findMany({ where: { billId } });
    expect(lines.find((l) => l.productId === glueId)?.unitCost?.toString()).toBe("400");
    expect(lines.find((l) => l.productId === combId)?.unitCost?.toString()).toBe("20");

    const original = await getOriginalBillSummary(billId);
    expect(original?.total).toBe("1600.00");
  });

  it("refuses to sell more than is in stock and saves nothing", async () => {
    const before = (await getBill(billId))!;
    await expect(
      updateBill(
        billUpdateSchema.parse({
          billId,
          billedAt: localInput(new Date(before.createdAt)),
          items: [{ kind: "PRODUCT", productId: combId, quantity: 3, unitPrice: "50" }], // only 2 on bill + 0 on shelf
        }),
        owner,
      ),
    ).rejects.toThrow(/available|out of stock/i);
    const after = (await getBill(billId))!;
    expect(after.total).toBe(before.total);
    expect((await getProduct(combId))?.quantity).toBe(0);
    expect((await getProduct(glueId))?.quantity).toBe(7);
  });

  it("back-dating moves the sale, its profit and products to the new day in the report", async () => {
    const today = { from: startOfDayInZone(new Date()), to: endOfDayInZone(new Date()) };
    const threeDaysAgo = addDaysInZone(new Date(), -3);
    const oldDay = { from: threeDaysAgo, to: endOfDayInZone(threeDaysAgo) };
    const beforeToday = await getSalesReport(today);
    const beforeOld = await getSalesReport(oldDay);

    const bill = (await getBill(billId))!;
    await updateBill(
      billUpdateSchema.parse({
        billId,
        billedAt: localInput(new Date(threeDaysAgo.getTime() + 11 * 3600_000)), // 11 AM that day
        items: bill.items.map((i) =>
          i.kind === "PRODUCT" ? { kind: "PRODUCT", productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice } : { kind: "SERVICE", name: i.name, quantity: i.quantity, unitPrice: i.unitPrice },
        ),
        discount: bill.discount,
        paymentMethod: bill.paymentMethod,
        customerName: bill.customerName ?? undefined,
      }),
      owner,
    );

    const afterToday = await getSalesReport(today);
    const afterOld = await getSalesReport(oldDay);
    expect(Number(afterToday.revenue)).toBeCloseTo(Number(beforeToday.revenue) - 1950, 2);
    expect(Number(afterOld.revenue)).toBeCloseTo(Number(beforeOld.revenue) + 1950, 2);
    expect(afterOld.billCount).toBe(beforeOld.billCount + 1);
    expect(afterOld.topProducts.map((p) => p.name)).toContain("Edit Glue");
    expect(Number(afterOld.grossProfit)).toBeGreaterThan(Number(beforeOld.grossProfit));
    // Stock is untouched by a date-only change.
    expect((await getProduct(glueId))?.quantity).toBe(7);
  });

  it("rejects a future date", async () => {
    const bill = (await getBill(billId))!;
    await expect(
      updateBill(
        billUpdateSchema.parse({
          billId,
          billedAt: localInput(addDaysInZone(new Date(), 2)),
          items: [{ kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "300" }],
        }),
        owner,
      ),
    ).rejects.toThrow(/future/i);
    expect((await getBill(billId))!.total).toBe(bill.total);
  });

  it("the manager cannot edit, and never sees that a bill was edited", async () => {
    const bill = (await getBill(billId))!;
    await expect(updateBill(billUpdateSchema.parse({ billId, billedAt: localInput(new Date(bill.createdAt)), items: [{ kind: "SERVICE", name: "X", quantity: 1, unitPrice: "1" }] }), manager)).rejects.toThrow(/owner/i);
    const seen = billForViewer(bill, manager.role);
    expect(seen.editedAt).toBeNull();
    expect(seen.editedByName).toBeNull();
    expect(billForViewer(bill, owner.role).editedAt).not.toBeNull();
  });

  it("a cancelled bill cannot be edited", async () => {
    const bill = (await getBill(billId))!;
    await cancelBill({ billId, reason: "Returned" }, owner);
    await expect(
      updateBill(billUpdateSchema.parse({ billId, billedAt: localInput(new Date(bill.createdAt)), items: [{ kind: "SERVICE", name: "X", quantity: 1, unitPrice: "1" }] }), owner),
    ).rejects.toThrow(/cancelled/i);
  });
});
