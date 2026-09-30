import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, getProduct } from "@/lib/services/products";
import { addBillPayment, cancelBill, createBill, deleteBillPayment, getBill, getOutstanding, getSalesReport, listBills, updateBill } from "@/lib/services/billing";
import { endOfDayInZone, startOfDayInZone, zonedParts } from "@/lib/timezone";
import { billCreateSchema, billPaymentSchema, billUpdateSchema, productCreateSchema } from "@/lib/validation/schemas";
import { can } from "@/lib/permissions";
import { createUser, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let otherManager: SessionUser;
let categoryId: string;

const customer = { customerName: "Priya", customerPhone: "9876543210" };
const haircut = (price: string) => ({ kind: "SERVICE" as const, name: "Haircut", quantity: 1, unitPrice: price });
const pay = (billId: string, amount: string, method: "CASH" | "UPI" | "CARD" = "CASH") => billPaymentSchema.parse({ billId, amount, method });

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
  otherManager = await createUser("MANAGER");
});

describe("making bills", () => {
  it("a normal bill is paid in full at the counter", async () => {
    const bill = await createBill(billCreateSchema.parse({ items: [haircut("300")], paymentMethod: "UPI" }), manager);
    expect(bill.balanceDue).toBe("0.00");
    expect(bill.amountPaid).toBe("300.00");
    expect(bill.payments).toEqual([expect.objectContaining({ amount: "300.00", method: "UPI", atBilling: true })]);
  });

  it("a pay-later bill needs the customer's name and phone", () => {
    const res = billCreateSchema.safeParse({ items: [haircut("300")], payLater: true });
    expect(res.success).toBe(false);
    const paths = res.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["customerName", "customerPhone"]));
  });

  it("pay later with a part paid now: stock goes out, the rest is due", async () => {
    const p = await createProduct(productCreateSchema.parse({ name: "Due Serum", categoryId, startingQuantity: 5, sellingPrice: "900" }), owner);
    const bill = await createBill(
      billCreateSchema.parse({ ...customer, items: [{ kind: "PRODUCT", productId: p.id, quantity: 1, unitPrice: "900" }, haircut("300")], payLater: true, paidNow: "500", paymentMethod: "CASH" }),
      manager,
    );
    expect((await getProduct(p.id))?.quantity).toBe(4);
    expect(bill.total).toBe("1200.00");
    expect(bill.amountPaid).toBe("500.00");
    expect(bill.balanceDue).toBe("700.00");
    expect(bill.paymentMethod).toBe("CASH");
  });

  it("pay later with nothing paid now has no counter payment", async () => {
    const bill = await createBill(billCreateSchema.parse({ ...customer, items: [haircut("400")], payLater: true }), manager);
    expect(bill.paymentMethod).toBeNull();
    expect(bill.payments).toEqual([]);
    expect(bill.balanceDue).toBe("400.00");
  });

  it("paid now can't be more than the total", async () => {
    await expect(createBill(billCreateSchema.parse({ ...customer, items: [haircut("400")], payLater: true, paidNow: "500" }), manager)).rejects.toThrow(/more than the bill total/);
  });
});

describe("collecting payments", () => {
  let billId = "";

  beforeAll(async () => {
    billId = (await createBill(billCreateSchema.parse({ ...customer, items: [haircut("1000")], payLater: true, paidNow: "200", paymentMethod: "CASH" }), manager)).id;
  });

  it("owner and manager can collect", () => {
    expect(can("MANAGER", "bill.collect")).toBe(true);
    expect(can("OWNER", "bill.collect")).toBe(true);
  });

  it("part payments reduce the balance; the bill is paid at zero", async () => {
    const after1 = await addBillPayment(pay(billId, "300", "UPI"), manager);
    expect(after1.balanceDue).toBe("500.00");
    await expect(addBillPayment(pay(billId, "600"), manager)).rejects.toThrow(/Only 500.00 is due/);
    const after2 = await addBillPayment(pay(billId, "500", "CARD"), owner);
    expect(after2.balanceDue).toBe("0.00");
    expect(after2.amountPaid).toBe("1000.00");
    expect(after2.payments.map((p) => [p.amount, p.method, p.atBilling])).toEqual([
      ["200.00", "CASH", true],
      ["300.00", "UPI", false],
      ["500.00", "CARD", false],
    ]);
    await expect(addBillPayment(pay(billId, "1"), owner)).rejects.toThrow(/already fully paid/);
    const audit = await prisma.auditLog.findFirst({ where: { action: "BILL_PAYMENT_RECEIVED", entityId: billId, actorId: manager.id } });
    expect(audit?.summary).toMatch(/Received 300.00 \(UPI\)/);
  });

  it("a manager removes only their own payments from today; the owner removes any; the counter payment is fixed by editing", async () => {
    const bill = (await getBill(billId))!;
    const managers = bill.payments.find((p) => p.method === "UPI")!;
    const owners = bill.payments.find((p) => p.method === "CARD")!;
    const counter = bill.payments.find((p) => p.atBilling)!;

    await expect(deleteBillPayment(managers.id, otherManager)).rejects.toThrow(/Only payments you entered today/);
    await expect(deleteBillPayment(owners.id, manager)).rejects.toThrow(/Only payments you entered today/);
    await expect(deleteBillPayment(counter.id, owner)).rejects.toThrow(/editing the bill/);

    expect((await deleteBillPayment(managers.id, manager)).balanceDue).toBe("300.00");
    expect((await deleteBillPayment(owners.id, owner)).balanceDue).toBe("800.00");
  });
});

describe("unpaid list and reports", () => {
  it("lists unpaid bills oldest first and totals what is owed", async () => {
    const before = await getOutstanding();
    const a = await createBill(billCreateSchema.parse({ ...customer, items: [haircut("250")], payLater: true }), manager);
    const list = await listBills({ unpaid: true, pageSize: 100 });
    expect(list.items.every((b) => Number(b.balanceDue) > 0 && b.status === "COMPLETED")).toBe(true);
    expect(list.items.at(-1)?.id).toBe(a.id);
    const created = list.items.map((b) => b.createdAt);
    expect([...created].sort()).toEqual(created);
    const after = await getOutstanding();
    expect(after.count).toBe(before.count + 1);
    expect(Number(after.amount) - Number(before.amount)).toBe(250);
  });

  it("sales count on the bill date; payments count when received; the balance shows as still to collect", async () => {
    const range = { from: startOfDayInZone(new Date()), to: endOfDayInZone(new Date()) };
    const before = await getSalesReport(range);
    const bill = await createBill(billCreateSchema.parse({ ...customer, items: [haircut("1000")], payLater: true, paidNow: "100", paymentMethod: "UPI" }), manager);
    await addBillPayment(pay(bill.id, "400", "CASH"), manager);
    const after = await getSalesReport(range);
    const method = (r: typeof after, m: string) => Number(r.byPayment.find((x) => x.method === m)!.amount);

    expect(Number(after.revenue) - Number(before.revenue)).toBe(1000);
    expect(method(after, "UPI") - method(before, "UPI")).toBe(100);
    expect(method(after, "CASH") - method(before, "CASH")).toBe(400);
    expect(Number(after.toCollect) - Number(before.toCollect)).toBe(500);
    expect(after.unpaidCount - before.unpaidCount).toBe(1);
  });
});

describe("cancelling and editing", () => {
  it("a cancelled bill leaves the unpaid list and takes no more payments", async () => {
    const bill = await createBill(billCreateSchema.parse({ ...customer, items: [haircut("600")], payLater: true, paidNow: "100" }), manager);
    await cancelBill({ billId: bill.id, reason: "Customer disputed" }, owner);
    expect((await listBills({ unpaid: true, pageSize: 100 })).items.map((b) => b.id)).not.toContain(bill.id);
    await expect(addBillPayment(pay(bill.id, "100"), manager)).rejects.toThrow(/cancelled/);
  });

  it("editing before anything is collected rewrites the counter payment from the form", async () => {
    const bill = await createBill(billCreateSchema.parse({ items: [haircut("500")], paymentMethod: "CASH" }), manager);
    const edited = await updateBill(
      billUpdateSchema.parse({ billId: bill.id, billedAt: localInput(new Date(bill.createdAt)), ...customer, items: [haircut("800")], payLater: true, paidNow: "300", paymentMethod: "UPI" }),
      owner,
    );
    expect(edited.balanceDue).toBe("500.00");
    expect(edited.payments).toEqual([expect.objectContaining({ amount: "300.00", method: "UPI", atBilling: true })]);

    const paidInFull = await updateBill(
      billUpdateSchema.parse({ billId: bill.id, billedAt: localInput(new Date(bill.createdAt)), items: [haircut("800")], paymentMethod: "CARD" }),
      owner,
    );
    expect(paidInFull.balanceDue).toBe("0.00");
    expect(paidInFull.payments).toEqual([expect.objectContaining({ amount: "800.00", method: "CARD", atBilling: true })]);
  });

  it("after money is collected, edits keep the payments and can't drop the total below them", async () => {
    const bill = await createBill(billCreateSchema.parse({ ...customer, items: [haircut("1000")], payLater: true, paidNow: "200" }), manager);
    await addBillPayment(pay(bill.id, "300"), manager);
    const base = { billId: bill.id, billedAt: localInput(new Date(bill.createdAt)), ...customer, payLater: true, paidNow: "0" };

    await expect(updateBill(billUpdateSchema.parse({ ...base, items: [haircut("400")] }), owner)).rejects.toThrow(/500.00 has already been received/);
    const edited = await updateBill(billUpdateSchema.parse({ ...base, items: [haircut("900")] }), owner);
    expect(edited.balanceDue).toBe("400.00");
    expect(edited.amountPaid).toBe("500.00");
    expect(edited.payments).toHaveLength(2);
  });
});
