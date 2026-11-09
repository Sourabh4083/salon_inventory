import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { createBill, updateBill } from "@/lib/services/billing";
import { discardOpenBill, getOpenBill, listBillingEmployees, listOpenBills, saveOpenBill } from "@/lib/services/open-bills";
import { billCreateSchema, billUpdateSchema, openBillSchema, productCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId: string;
let ritu: string;
let aman: string;
let serumId: string;

const haircut = { kind: "SERVICE" as const, name: "Haircut", quantity: 1, unitPrice: "300" };
const serum = (quantity = 1) => ({ kind: "PRODUCT" as const, productId: serumId, name: "Open Serum", quantity, unitPrice: "900" });

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
  ritu = (await prisma.employee.create({ data: { name: "Ritu" } })).id;
  aman = (await prisma.employee.create({ data: { name: "Aman" } })).id;
  serumId = (await createProduct(productCreateSchema.parse({ name: "Open Serum", categoryId, startingQuantity: 5, sellingPrice: "900" }), owner)).id;
});

describe("open bills", () => {
  it("needs the employee handling the customer, not the customer's name", () => {
    const res = openBillSchema.safeParse({ employeeIds: [], items: [haircut] });
    expect(res.success).toBe(false);
    expect(res.error!.issues.map((i) => i.path.join("."))).toEqual(["employeeIds"]);
    expect(openBillSchema.safeParse({ employeeIds: [ritu], items: [haircut] }).success).toBe(true);
  });

  it("is kept open without touching stock, then added to", async () => {
    const opened = await saveOpenBill(openBillSchema.parse({ employeeIds: [ritu], items: [serum()] }), manager);
    expect(opened.employeeNames).toEqual(["Ritu"]);
    expect(opened.customerName).toBeNull();
    expect(opened.total).toBe("900.00");
    expect((await getProduct(serumId))?.quantity).toBe(5);

    const added = await saveOpenBill(openBillSchema.parse({ id: opened.id, employeeIds: [ritu], items: [serum(2), haircut] }), owner);
    expect(added.id).toBe(opened.id);
    expect(added.total).toBe("2100.00");
    expect(added.itemCount).toBe(3);
    expect((await getProduct(serumId))?.quantity).toBe(5);

    const list = await listOpenBills();
    expect(list.map((o) => o.id)).toEqual([opened.id]);
    const loaded = await getOpenBill(opened.id);
    expect(loaded?.lines[0]).toMatchObject({ kind: "PRODUCT", productId: serumId, quantity: 2, available: 5 });
  });

  it("completing makes the bill, reduces stock and removes the open bill; a second time fails", async () => {
    const [open] = await listOpenBills();
    const input = billCreateSchema.parse({
      openBillId: open.id,
      items: [{ kind: "PRODUCT", productId: serumId, quantity: 2, unitPrice: "900" }, haircut],
      paymentMethod: "CASH",
    });
    const bill = await createBill(input, manager);
    expect(bill.total).toBe("2100.00");
    expect((await getProduct(serumId))?.quantity).toBe(3);
    expect(await listOpenBills()).toEqual([]);

    await expect(createBill(input, manager)).rejects.toThrow(/already completed or discarded/);
    expect((await getProduct(serumId))?.quantity).toBe(3);
  });

  it("a failed completion leaves the open bill in place", async () => {
    const open = await saveOpenBill(openBillSchema.parse({ employeeIds: [aman], customerName: "Priya", items: [serum(9)] }), manager);
    await expect(
      createBill(billCreateSchema.parse({ openBillId: open.id, items: [{ kind: "PRODUCT", productId: serumId, quantity: 9, unitPrice: "900" }] }), manager),
    ).rejects.toThrow(/Only 3/);
    expect((await listOpenBills()).map((o) => o.id)).toEqual([open.id]);
  });

  it("can be handed to another employee and discarded, which the audit log records", async () => {
    const [open] = await listOpenBills();
    const moved = await saveOpenBill(openBillSchema.parse({ id: open.id, employeeIds: [ritu], customerName: "Priya", items: [serum(1)] }), manager);
    expect(moved.employeeNames).toEqual(["Ritu"]);

    await discardOpenBill(open.id, manager);
    expect(await listOpenBills()).toEqual([]);
    expect((await getProduct(serumId))?.quantity).toBe(3);
    const log = await prisma.auditLog.findFirst({ where: { action: "OPEN_BILL_DISCARDED", entityId: open.id } });
    expect(log?.summary).toContain("Ritu");
    expect(log?.summary).toContain("Open Serum");
    await expect(discardOpenBill(open.id, manager)).rejects.toThrow(/already completed or discarded/);
  });

  it("only offers employees who are working", async () => {
    await prisma.employee.update({ where: { id: aman }, data: { isActive: false } });
    expect((await listBillingEmployees()).map((e) => e.name)).toEqual(["Ritu"]);
    await expect(saveOpenBill(openBillSchema.parse({ employeeIds: [aman], items: [haircut] }), manager)).rejects.toThrow(/currently working/);
  });

  it("drops a product that was archived while the bill was open", async () => {
    const open = await saveOpenBill(openBillSchema.parse({ employeeIds: [ritu], items: [serum(1), haircut] }), manager);
    await prisma.product.update({ where: { id: serumId }, data: { status: "ARCHIVED" } });
    expect((await getOpenBill(open.id))?.lines.map((l) => l.name)).toEqual(["Haircut"]);
  });
});

describe("employees on a bill", () => {
  let neha: string;
  let ravi: string;

  beforeAll(async () => {
    neha = (await prisma.employee.create({ data: { name: "Neha" } })).id;
    ravi = (await prisma.employee.create({ data: { name: "Ravi" } })).id;
  });

  it("an open bill can be handled by several employees, and completing it keeps them on the bill", async () => {
    const open = await saveOpenBill(openBillSchema.parse({ employeeIds: [ravi, neha, ravi], items: [haircut] }), manager);
    expect(open.employeeNames).toEqual(["Neha", "Ravi"]);

    // An employee deactivated while the customer is in the shop stays on their open bill.
    await prisma.employee.update({ where: { id: ravi }, data: { isActive: false } });
    expect((await listBillingEmployees(open.employeeIds)).map((e) => e.name)).toContain("Ravi");
    const bill = await createBill(billCreateSchema.parse({ openBillId: open.id, employeeIds: open.employeeIds, items: [haircut] }), manager);
    expect(bill.employeeNames).toEqual(["Neha", "Ravi"]);
    await prisma.employee.update({ where: { id: ravi }, data: { isActive: true } });
  });

  it("is optional when completing a bill", async () => {
    const bill = await createBill(billCreateSchema.parse({ items: [haircut] }), manager);
    expect(bill.employeeNames).toEqual([]);
  });

  it("rejects an unknown or deactivated employee on a new bill", async () => {
    await expect(createBill(billCreateSchema.parse({ employeeIds: ["nope"], items: [haircut] }), manager)).rejects.toThrow(/currently working/);
    await expect(createBill(billCreateSchema.parse({ employeeIds: [aman], items: [haircut] }), manager)).rejects.toThrow(/currently working/);
  });

  it("the owner can change who handled a bill", async () => {
    const bill = await createBill(billCreateSchema.parse({ employeeIds: [neha], items: [haircut] }), manager);
    const edited = await updateBill(
      billUpdateSchema.parse({ billId: bill.id, billedAt: "2026-01-05T10:00", employeeIds: [neha, ravi], items: [haircut] }),
      owner,
    );
    expect(edited.employeeNames).toEqual(["Neha", "Ravi"]);
    const cleared = await updateBill(billUpdateSchema.parse({ billId: bill.id, billedAt: "2026-01-05T10:00", items: [haircut] }), owner);
    expect(cleared.employeeNames).toEqual([]);
  });
});
