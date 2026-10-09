import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/lib/services/products";
import { addBillPayment, cancelBill, createBill } from "@/lib/services/billing";
import { addSalaryPayment, createEmployee } from "@/lib/services/employees";
import { recordAdvance } from "@/lib/services/advances";
import { createExpense } from "@/lib/services/expenses";
import { createOrder, receiveOrder } from "@/lib/services/orders";
import { recordStockIn } from "@/lib/services/inventory";
import { deleteCashDeposit, getBalances, getMoneyMovement, listMoneyEntries, moveCashToBank, setBalances } from "@/lib/services/cashbook";
import {
  advanceSchema,
  balancesSchema,
  cashDepositSchema,
  billCreateSchema,
  billPaymentSchema,
  employeeSchema,
  expenseSchema,
  orderCreateSchema,
  orderReceiveSchema,
  productCreateSchema,
  salaryPaymentSchema,
} from "@/lib/validation/schemas";
import { endOfDay, startOfDay, toDateParam, toMonthParam } from "@/lib/dates";
import { addDaysInZone } from "@/lib/timezone";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

type Method = "CASH" | "UPI" | "CARD";

let owner: SessionUser;
let manager: SessionUser;
let categoryId = "";

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

const today = () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
const expense = (amount: string, paymentMethod: Method, extra: Record<string, unknown> = {}) => createExpense(expenseSchema.parse({ amount, description: "Water", paymentMethod, ...extra }), owner);
const serviceBill = (amount: string, extra: Record<string, unknown>) => createBill(billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: amount }], ...extra }), manager);
const employee = () => createEmployee(employeeSchema.parse({ name: "Sunita", monthlySalary: "15000" }), owner);
const product = (name: string, overrides: Record<string, unknown> = {}) => createProduct(productCreateSchema.parse({ name, categoryId, startingQuantity: 0, ...overrides }), owner);
/** Entries are counted once they are typed in after the balance was set. */
const tick = () => new Promise((r) => setTimeout(r, 15));

describe("money in and out for a period", () => {
  it("takes an expense from the account it was paid from", async () => {
    await expense("120", "UPI");
    let m = await getMoneyMovement(today());
    expect(m.bank).toMatchObject({ expenses: "120.00", out: "120.00", change: "-120.00" });
    expect(m.cash.change).toBe("0.00");

    await expense("50", "CASH");
    await expense("30", "CARD");
    m = await getMoneyMovement(today());
    expect(m.cash.change).toBe("-50.00");
    expect(m.bank.change).toBe("-150.00");
    expect(m.total).toMatchObject({ expenses: "200.00", change: "-200.00" });
  });

  it("adds what customers paid, when they paid it, and ignores cancelled bills", async () => {
    await serviceBill("500", { paymentMethod: "CARD" });
    await serviceBill("300", { paymentMethod: "CASH" });
    const later = await serviceBill("1000", { customerName: "Ravi", customerPhone: "9876543210", payLater: true });
    const cancelled = await serviceBill("700", { paymentMethod: "UPI" });
    await cancelBill({ billId: cancelled.id, reason: "test" }, owner);

    let m = await getMoneyMovement(today());
    expect(m.cash.received).toBe("300.00");
    expect(m.bank.received).toBe("500.00");

    await addBillPayment(billPaymentSchema.parse({ billId: later.id, amount: "400", method: "UPI" }), manager);
    m = await getMoneyMovement(today());
    expect(m.bank.received).toBe("900.00");
    expect(m.total.change).toBe("1200.00");
  });

  it("takes salary and advances from their accounts without counting an advance twice", async () => {
    const e = await employee();
    await recordAdvance(advanceSchema.parse({ employeeId: e.id, amount: "500" }), manager);
    await recordAdvance(advanceSchema.parse({ employeeId: e.id, amount: "1000", paymentMethod: "UPI" }), owner);
    // 15000 less the 1500 already taken.
    await addSalaryPayment(salaryPaymentSchema.parse({ employeeId: e.id, amount: "13500", paidOn: toDateParam(new Date()), periodMonth: toMonthParam(), advanceDeducted: "1500", paymentMethod: "UPI" }), owner);

    const m = await getMoneyMovement(today());
    expect(m.cash).toMatchObject({ advances: "500.00", salary: "0.00", out: "500.00" });
    expect(m.bank).toMatchObject({ advances: "1000.00", salary: "13500.00", out: "14500.00" });
    expect(m.total.out).toBe("15000.00");
  });

  it("takes received stock from the account chosen on receipt, at the order's cost", async () => {
    const glue = await product("Glue");
    const tape = await product("Tape");
    const o = await createOrder(orderCreateSchema.parse({ items: [{ productId: glue.id, quantity: 4, unitCost: "120" }, { productId: tape.id, quantity: 6 }] }), owner);
    const glueLine = o.items.find((i) => i.productId === glue.id)!;

    await receiveOrder(orderReceiveSchema.parse({ orderId: o.id, lines: [{ itemId: glueLine.id, quantity: 1 }], paymentMethod: "UPI" }), manager);
    await receiveOrder(orderReceiveSchema.parse({ orderId: o.id, lines: "ALL" }), manager);
    // Stock added by hand, or received before the method was recorded, has no account.
    await recordStockIn({ productId: glue.id, quantity: 5, unitCost: "120" }, owner);

    const m = await getMoneyMovement(today());
    expect(m.bank.stock).toBe("120.00");
    expect(m.cash.stock).toBe("360.00"); // 3 glue; the tape has no cost price
    expect(await prisma.stockMovement.count({ where: { paymentMethod: null, type: "STOCK_IN" } })).toBe(1);
  });

  it("lists every entry in the passbook, newest first, one line per delivery", async () => {
    const e = await employee();
    const glue = await product("Glue");
    const tape = await product("Tape");
    const bill = await serviceBill("500", { paymentMethod: "CARD", customerName: "Ravi" });
    await expense("120", "UPI");
    await recordAdvance(advanceSchema.parse({ employeeId: e.id, amount: "200" }), manager);
    const o = await createOrder(orderCreateSchema.parse({ items: [{ productId: glue.id, quantity: 2, unitCost: "100" }, { productId: tape.id, quantity: 1, unitCost: "50" }] }), owner);
    await receiveOrder(orderReceiveSchema.parse({ orderId: o.id, lines: "ALL", paymentMethod: "CARD" }), manager);
    await expense("999", "CASH", { spentOn: toDateParam(addDaysInZone(new Date(), -3)) });

    const { items, more } = await listMoneyEntries(today());
    expect(more).toBe(false);
    expect(items.map((i) => [i.label, i.account, i.amount])).toEqual([
      [`Stock · ${o.orderNumber}`, "bank", "-250.00"],
      ["Advance · Sunita", "cash", "-200.00"],
      ["Water", "bank", "-120.00"],
      [`${bill.billNumber} · Ravi`, "bank", "500.00"],
    ]);
    expect(items[3].href).toBe(`/billing/${bill.id}`);
    expect((await listMoneyEntries(today(), 2)).more).toBe(true);
  });
});

describe("running balances", () => {
  it("are empty until the owner sets them, and only the owner can", async () => {
    expect(await getBalances()).toBeNull();
    await expect(setBalances(balancesSchema.parse({ cash: "5000", bank: "20000" }), manager)).rejects.toThrow(/owner/i);
    expect(balancesSchema.safeParse({ cash: "", bank: "100" }).success).toBe(false);

    await setBalances(balancesSchema.parse({ cash: "5000", bank: "20000" }), owner);
    expect(await getBalances()).toMatchObject({ cash: "5000.00", bank: "20000.00", total: "25000.00", openingCash: "5000.00", openingBank: "20000.00" });
    expect(await prisma.auditLog.count({ where: { action: "BALANCES_SET" } })).toBe(1);
  });

  it("follow what is typed in afterwards: water for 120 by UPI leaves 19,880 in the bank", async () => {
    // Already spent before the count, so already missing from the drawer.
    await expense("75", "CASH");
    await setBalances(balancesSchema.parse({ cash: "5000", bank: "20000" }), owner);
    await tick();

    await expense("120", "UPI");
    expect(await getBalances()).toMatchObject({ cash: "5000.00", bank: "19880.00" });

    await serviceBill("300", { paymentMethod: "CASH" });
    const e = await employee();
    await addSalaryPayment(salaryPaymentSchema.parse({ employeeId: e.id, amount: "15000", paidOn: toDateParam(new Date()), paymentMethod: "CARD" }), owner);
    expect(await getBalances()).toMatchObject({ cash: "5300.00", bank: "4880.00", total: "10180.00" });
  });

  it("cash moved to the bank leaves the drawer, lands in the bank and keeps the total", async () => {
    const move = (amount: string, who = owner) => moveCashToBank(cashDepositSchema.parse({ amount }), who);
    await expect(move("100")).rejects.toThrow(/balance first/i);

    await setBalances(balancesSchema.parse({ cash: "5000", bank: "20000" }), owner);
    await tick();
    await expect(move("100", manager)).rejects.toThrow(/owner/i);
    await expect(move("5000.01")).rejects.toThrow(/Only .*5,000.* is in the drawer/);
    expect(cashDepositSchema.safeParse({ amount: "0" }).success).toBe(false);

    await move("3000");
    expect(await getBalances()).toMatchObject({ cash: "2000.00", bank: "23000.00", total: "25000.00" });
    await move("2000");
    expect(await getBalances()).toMatchObject({ cash: "0.00", bank: "25000.00", total: "25000.00" });

    const m = await getMoneyMovement(today());
    expect([m.cash.moved, m.bank.moved, m.total.moved]).toEqual(["-5000.00", "5000.00", "0.00"]);
    expect([m.cash.change, m.bank.change, m.total.change, m.total.out]).toEqual(["-5000.00", "5000.00", "0.00", "0.00"]);

    // Two passbook lines per move: out of the drawer, into the bank.
    const { items } = await listMoneyEntries(today());
    expect(items.map((i) => [i.label, i.account, i.amount]).sort()).toEqual(
      [
        ["Cash moved to bank", "cash", "-3000.00"],
        ["Cash deposited", "bank", "3000.00"],
        ["Cash moved to bank", "cash", "-2000.00"],
        ["Cash deposited", "bank", "2000.00"],
      ].sort(),
    );

    const first = items.find((i) => i.amount === "-3000.00")!;
    await expect(deleteCashDeposit(first.depositId!, manager)).rejects.toThrow(/owner/i);
    await deleteCashDeposit(first.depositId!, owner);
    expect(await getBalances()).toMatchObject({ cash: "3000.00", bank: "22000.00", total: "25000.00" });
    expect(await prisma.auditLog.count({ where: { action: { in: ["CASH_TO_BANK", "CASH_TO_BANK_DELETED"] } } })).toBe(3);
  });

  it("ignore an entry back-dated to before the count, and restart when corrected", async () => {
    await setBalances(balancesSchema.parse({ cash: "1000", bank: "0" }), owner);
    await tick();
    await expense("400", "CASH", { spentOn: toDateParam(addDaysInZone(new Date(), -2)) });
    await expense("100", "CASH");
    expect((await getBalances())!.cash).toBe("900.00");

    await tick();
    await setBalances(balancesSchema.parse({ cash: "250", bank: "600" }), owner);
    expect(await getBalances()).toMatchObject({ cash: "250.00", bank: "600.00" });
  });
});
