import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { cancelBill, createBill, createService, getSalesReport, listBills, listServices, updateService } from "@/lib/services/billing";
import { billCreateSchema, productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;

function productInput(overrides: Record<string, unknown>) {
  return productCreateSchema.parse({ name: "X", categoryId, startingQuantity: 0, ...overrides });
}

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

describe("create bill", () => {
  it("manager bills products and a service, stock drops, totals are exact", async () => {
    const glue = await createProduct(productInput({ name: "Bill Glue", sellingPrice: "600", costPrice: "400", startingQuantity: 10 }), owner);
    const tape = await createProduct(productInput({ name: "Bill Tape", sellingPrice: "150.50", startingQuantity: 5 }), owner);

    const bill = await createBill(
      billCreateSchema.parse({
        items: [
          { kind: "PRODUCT", productId: glue.id, quantity: 2, unitPrice: "600" },
          { kind: "PRODUCT", productId: tape.id, quantity: 1, unitPrice: "150.50" },
          { kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "300" },
        ],
        customerName: "Ravi",
        customerPhone: "9876543210",
        discount: "50",
        paymentMethod: "UPI",
      }),
      manager,
    );

    expect(bill.billNumber).toBe("BILL-000001");
    expect(bill.status).toBe("COMPLETED");
    expect(bill.subtotal).toBe("1650.50");
    expect(bill.discount).toBe("50.00");
    expect(bill.total).toBe("1600.50");
    expect(bill.items).toHaveLength(3);
    expect(bill.itemCount).toBe(4);
    expect(bill.createdByName).toBe(manager.name);

    expect((await getProduct(glue.id))?.quantity).toBe(8);
    expect((await getProduct(tape.id))?.quantity).toBe(4);

    const movements = await prisma.stockMovement.findMany({ where: { billId: bill.id } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === "SALE")).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "BILL_CREATED", entityId: bill.id } });
    expect(audit?.summary).toContain("BILL-000001");
  });

  it("merges duplicate product lines and refuses to oversell, saving nothing", async () => {
    const p = await createProduct(productInput({ name: "Scarce Item", sellingPrice: "100", startingQuantity: 3 }), owner);
    const before = await prisma.bill.count();
    await expect(
      createBill(
        billCreateSchema.parse({
          items: [
            { kind: "PRODUCT", productId: p.id, quantity: 2, unitPrice: "100" },
            { kind: "PRODUCT", productId: p.id, quantity: 2, unitPrice: "100" },
          ],
        }),
        manager,
      ),
    ).rejects.toThrow(/Only 3 of "Scarce Item" available/);
    expect(await prisma.bill.count()).toBe(before);
    expect((await getProduct(p.id))?.quantity).toBe(3);
  });

  it("rejects archived products, empty bills and discounts above subtotal", async () => {
    const p = await createProduct(productInput({ name: "Archived Thing", sellingPrice: "100", startingQuantity: 3 }), owner);
    await prisma.product.update({ where: { id: p.id }, data: { status: "ARCHIVED" } });
    await expect(
      createBill(billCreateSchema.parse({ items: [{ kind: "PRODUCT", productId: p.id, quantity: 1, unitPrice: "100" }] }), manager),
    ).rejects.toThrow(/archived/i);

    expect(billCreateSchema.safeParse({ items: [] }).success).toBe(false);

    await expect(
      createBill(billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Wash", quantity: 1, unitPrice: "100" }], discount: "150" }), manager),
    ).rejects.toThrow(/Discount cannot be more/);
  });

  it("service-only bills work and use the saved service price snapshot", async () => {
    const svc = await createService({ name: "Beard Trim", price: "200" }, owner);
    const bill = await createBill(
      billCreateSchema.parse({ items: [{ kind: "SERVICE", serviceId: svc.id, name: svc.name, quantity: 2, unitPrice: svc.price }], paymentMethod: "CASH" }),
      manager,
    );
    expect(bill.total).toBe("400.00");
    expect(bill.items[0].serviceId).toBe(svc.id);
    // Changing the catalogue price later does not alter the bill.
    await updateService(svc.id, { price: "250" }, owner);
    const again = await listBills({ search: "Beard" });
    expect(again.items[0].items[0].unitPrice).toBe("200.00");
  });
});

describe("cancel bill", () => {
  it("owner cancels a bill and stock is restored with BILL_CANCELLED movements", async () => {
    const p = await createProduct(productInput({ name: "Cancel Me Comb", sellingPrice: "80", startingQuantity: 6 }), owner);
    const bill = await createBill(billCreateSchema.parse({ items: [{ kind: "PRODUCT", productId: p.id, quantity: 4, unitPrice: "80" }] }), manager);
    expect((await getProduct(p.id))?.quantity).toBe(2);

    const cancelled = await cancelBill({ billId: bill.id, reason: "Customer changed mind" }, owner);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("Customer changed mind");
    expect(cancelled.cancelledByName).toBe(owner.name);
    expect((await getProduct(p.id))?.quantity).toBe(6);

    const restore = await prisma.stockMovement.findFirst({ where: { billId: bill.id, type: "BILL_CANCELLED" } });
    expect(restore?.quantityChange).toBe(4);

    await expect(cancelBill({ billId: bill.id, reason: "Again" }, owner)).rejects.toThrow(/already cancelled/i);
  });

  it("manager cannot cancel a bill", async () => {
    const bill = await createBill(billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Shave", quantity: 1, unitPrice: "100" }] }), manager);
    await expect(cancelBill({ billId: bill.id, reason: "Nope" }, manager)).rejects.toThrow(/owner/i);
  });
});

describe("services catalogue", () => {
  it("prevents duplicates and hides inactive services from the active list", async () => {
    const s = await createService({ name: "Hair Spa", price: "900" }, owner);
    await expect(createService({ name: "hair spa", price: "1" }, owner)).rejects.toThrow(/already exists/i);
    await updateService(s.id, { isActive: false }, owner);
    expect((await listServices({ activeOnly: true })).some((x) => x.id === s.id)).toBe(false);
    expect((await listServices()).some((x) => x.id === s.id)).toBe(true);
  });
});

describe("sales report", () => {
  it("summarises completed bills only, with profit from cost prices", async () => {
    await prisma.billItem.deleteMany();
    await prisma.bill.deleteMany();
    const p = await createProduct(productInput({ name: "Report Serum", sellingPrice: "500", costPrice: "300", startingQuantity: 20 }), owner);

    await createBill(
      billCreateSchema.parse({
        items: [
          { kind: "PRODUCT", productId: p.id, quantity: 2, unitPrice: "500" },
          { kind: "SERVICE", name: "Styling", quantity: 1, unitPrice: "1000" },
        ],
        discount: "100",
        paymentMethod: "CARD",
      }),
      manager,
    );
    const toCancel = await createBill(billCreateSchema.parse({ items: [{ kind: "PRODUCT", productId: p.id, quantity: 5, unitPrice: "500" }] }), manager);
    await cancelBill({ billId: toCancel.id, reason: "test" }, owner);

    const now = new Date();
    const report = await getSalesReport({ from: new Date(now.getTime() - 3_600_000), to: new Date(now.getTime() + 3_600_000) });
    expect(report.billCount).toBe(1);
    expect(report.cancelledCount).toBe(1);
    expect(report.revenue).toBe("1900.00");
    expect(report.discount).toBe("100.00");
    expect(report.productRevenue).toBe("1000.00");
    expect(report.serviceRevenue).toBe("1000.00");
    expect(report.unitsSold).toBe(2);
    expect(report.cost).toBe("600.00");
    // product share of the 100 discount is 50 -> 1000 - 50 - 600
    expect(report.grossProfit).toBe("350.00");
    expect(report.byPayment.find((b) => b.method === "CARD")?.amount).toBe("1900.00");
    expect(report.byDay).toHaveLength(1);
    expect(report.topProducts[0]).toMatchObject({ name: "Report Serum", quantity: 2, amount: "1000.00" });
    expect(report.topServices[0]).toMatchObject({ name: "Styling", quantity: 1, amount: "1000.00" });
  });
});
