import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelBill, createBill, listBills } from "@/lib/services/billing";
import { getCustomerHistory, searchCustomers } from "@/lib/services/customers";
import { billCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let manager: SessionUser;
let owner: SessionUser;

beforeEach(async () => {
  const s = await seedBasics();
  manager = s.manager;
  owner = s.owner;
});

const bill = (customerName: string | undefined, customerPhone: string | undefined, service = "Haircut") =>
  createBill(billCreateSchema.parse({ items: [{ kind: "SERVICE", name: service, quantity: 1, unitPrice: "300" }], customerName, customerPhone }), manager);

describe("remembering customers", () => {
  it("stores the last 10 digits of the phone on each bill", async () => {
    const b = await bill("Priya S", "+91 98765-43210");
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: b.id } })).customerPhoneKey).toBe("9876543210");
    const noPhone = await bill("Walk-in", undefined);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: noPhone.id } })).customerPhoneKey).toBeNull();
  });

  it("suggests a customer by name or phone, counting visits however the number was typed", async () => {
    await bill("Priya", "98765 43210");
    await bill("Priya Sharma", "+919876543210", "Facial");
    await bill("Pritam", "9123456789");
    await bill("Priya no phone", undefined);

    const byName = await searchCustomers("priy");
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ phoneKey: "9876543210", name: "Priya Sharma", phone: "+919876543210", visits: 2 });

    expect((await searchCustomers("pri")).map((c) => c.phoneKey).sort()).toEqual(["9123456789", "9876543210"]);
    expect((await searchCustomers("91234")).map((c) => c.name)).toEqual(["Pritam"]);
    expect(await searchCustomers("p")).toEqual([]);
  });

  it("leaves cancelled bills out", async () => {
    await bill("Ravi", "9811111111");
    const cancelled = await bill("Ravi", "9811111111");
    await cancelBill({ billId: cancelled.id, reason: "Mistake" }, owner);

    expect((await searchCustomers("ravi"))[0].visits).toBe(1);
    const history = await getCustomerHistory("9811111111");
    expect(history.visits).toBe(1);
    expect(history.bills.map((b) => b.id)).not.toContain(cancelled.id);
  });

  it("shows visits, last visit, money owed and recent bills newest first", async () => {
    const first = await bill("Asha", "9000000001", "Haircut");
    const second = await createBill(
      billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Hair spa", quantity: 1, unitPrice: "800" }], customerName: "Asha", customerPhone: "90000 00001", payLater: true, paidNow: "300", paymentMethod: "CASH" }),
      manager,
    );

    const history = await getCustomerHistory("9000000001");
    expect(history.visits).toBe(2);
    expect(history.owes).toBe("500.00");
    expect(history.bills.map((b) => b.id)).toEqual([second.id, first.id]);
    expect(history.bills[0].items).toEqual(["Hair spa"]);
    expect(history.lastVisit).toBe(history.bills[0].createdAt);
  });

  it("finds a customer's bills on the bills page by phone in any format", async () => {
    await bill("Neha", "98111 22233");
    expect((await listBills({ search: "+91 9811122233" })).total).toBe(1);
  });
});
