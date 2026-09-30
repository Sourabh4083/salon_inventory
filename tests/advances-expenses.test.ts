import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addSalaryPayment, createEmployee, getEmployee, getEmployeeBasic, getEmployeeSalary, listEmployees, listEmployeesBasic, setEmployeeActive } from "@/lib/services/employees";
import { advanceTotalForMonth, deleteAdvance, listAdvances, recordAdvance } from "@/lib/services/advances";
import { createExpense, deleteExpense, expenseTotal, listExpenses, updateExpense } from "@/lib/services/expenses";
import { monthRange, toDateParam, toMonthParam } from "@/lib/dates";
import { addDaysInZone, zonedDate } from "@/lib/timezone";
import { advanceSchema, employeeSchema, expenseSchema, salaryPaymentSchema } from "@/lib/validation/schemas";
import { can } from "@/lib/permissions";
import { createUser, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let otherManager: SessionUser;
let employeeId = "";

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  otherManager = await createUser("MANAGER");
  employeeId = (
    await createEmployee(employeeSchema.parse({ name: "Sunita", designation: "Stylist", phone: "9876543210", aadhaarNumber: "123456789012", monthlySalary: "15000", address: "Home" }), owner)
  ).id;
});

describe("permissions", () => {
  it("manager can view employees and note advances and expenses, but not manage", () => {
    for (const p of ["employee.view", "advance.record", "expense.record", "salary.view"] as const) expect(can("MANAGER", p)).toBe(true);
    for (const p of ["employee.manage", "expense.manage", "bill.edit", "data.export"] as const) {
      expect(can("MANAGER", p)).toBe(false);
      expect(can("OWNER", p)).toBe(true);
    }
  });
});

describe("manager's view of employees", () => {
  it("shows only basic details of active employees", async () => {
    const list = await listEmployeesBasic({}, manager);
    const row = list.items.find((e) => e.id === employeeId)!;
    expect(row).toEqual({ id: employeeId, name: "Sunita", designation: "Stylist", phone: "9876543210", joinedAt: null, isActive: true });
    const one = await getEmployeeBasic(employeeId, manager);
    expect(Object.keys(one!).sort()).toEqual(["designation", "id", "isActive", "joinedAt", "name", "phone"]);
    await expect(getEmployee(employeeId, manager)).rejects.toThrow(/owner/i);
    await expect(listEmployees({}, manager)).rejects.toThrow(/owner/i);
  });

  it("shows the monthly salary so the manager can answer pay questions", async () => {
    expect(await getEmployeeSalary(employeeId, manager)).toBe("15000");
  });

  it("hides employees who have left", async () => {
    const gone = await createEmployee(employeeSchema.parse({ name: "Left Person" }), owner);
    await setEmployeeActive(gone.id, false, owner);
    expect((await listEmployeesBasic({}, manager)).items.map((e) => e.id)).not.toContain(gone.id);
    expect(await getEmployeeBasic(gone.id, manager)).toBeNull();
    expect(await getEmployeeSalary(gone.id, manager)).toBeNull();
    await expect(recordAdvance(advanceSchema.parse({ employeeId: gone.id, amount: "100" }), manager)).rejects.toThrow(/left/i);
  });
});

describe("advances", () => {
  it("manager records advances dated today, whatever date is sent", async () => {
    const a = await recordAdvance(advanceSchema.parse({ employeeId, amount: "500", note: "Bus fare", takenOn: "2020-01-01" }), manager);
    expect(toDateParam(new Date(a.takenOn))).toBe(toDateParam(new Date()));
    expect(a.canDelete).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "ADVANCE_RECORDED", entityId: employeeId } });
    expect(audit?.actorId).toBe(manager.id);
  });

  it("owner can back-date; the manager sees the chosen month's entries", async () => {
    const lastMonthDay = addDaysInZone(zonedDate(Number(toMonthParam().slice(0, 4)), Number(toMonthParam().slice(5)), 1), -5);
    await recordAdvance(advanceSchema.parse({ employeeId, amount: "700", takenOn: toDateParam(lastMonthDay) }), owner);
    await recordAdvance(advanceSchema.parse({ employeeId, amount: "250.50" }), owner);

    const managerView = await listAdvances(employeeId, manager);
    expect(managerView.items.map((a) => a.amount).sort()).toEqual(["250.5", "500"]);
    expect(managerView.total).toBe("750.50");
    const managerLastMonth = await listAdvances(employeeId, manager, toMonthParam(lastMonthDay));
    expect(managerLastMonth.items.map((a) => a.amount)).toEqual(["700"]);
    expect(managerLastMonth.items[0].canDelete).toBe(false);

    const ownerView = await listAdvances(employeeId, owner);
    expect(ownerView.total).toBe("750.50");
    expect(await advanceTotalForMonth(employeeId, toMonthParam(lastMonthDay), owner)).toBe("700.00");
    await expect(advanceTotalForMonth(employeeId, toMonthParam(), manager)).rejects.toThrow(/owner/i);
  });

  it("rejects future dates and non-positive amounts", async () => {
    await expect(recordAdvance(advanceSchema.parse({ employeeId, amount: "10", takenOn: toDateParam(addDaysInZone(new Date(), 3)) }), owner)).rejects.toThrow(/future/i);
    expect(advanceSchema.safeParse({ employeeId, amount: "0" }).success).toBe(false);
  });

  it("month boundaries follow the salon's zone", () => {
    const r = monthRange("2026-09");
    expect(r.from.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-30T18:29:59.999Z");
  });

  it("a manager can remove only their own entries from today; the owner can remove any", async () => {
    const mine = await recordAdvance(advanceSchema.parse({ employeeId, amount: "40" }), manager);
    const others = await recordAdvance(advanceSchema.parse({ employeeId, amount: "60" }), otherManager);
    await expect(deleteAdvance(others.id, manager)).rejects.toThrow(/only entries you made today/i);
    await deleteAdvance(mine.id, manager);
    await deleteAdvance(others.id, owner);
    expect(await prisma.employeeAdvance.count({ where: { id: { in: [mine.id, others.id] } } })).toBe(0);
  });

  it("the owner sees this month's advances on the employee and deducts them from the salary", async () => {
    const detail = await getEmployee(employeeId, owner);
    expect(detail?.advancesThisMonth).toBe("750.50");
    const list = await listEmployees({}, owner);
    expect(list.items.find((e) => e.id === employeeId)?.advancesThisMonth).toBe("750.50");

    const pay = await addSalaryPayment(
      salaryPaymentSchema.parse({ employeeId, amount: "14249.50", paidOn: toDateParam(new Date()), periodMonth: toMonthParam(), advanceDeducted: "750.50" }),
      owner,
    );
    expect(pay.advanceDeducted).toBe("750.5");
    expect(pay.amount).toBe("14249.5");
  });
});

describe("expenses", () => {
  it("manager adds expenses dated today and sees only today's", async () => {
    const e = await createExpense(expenseSchema.parse({ amount: "120", description: "Tea", spentOn: "2020-01-01" }), manager);
    expect(toDateParam(new Date(e.spentOn))).toBe(toDateParam(new Date()));
    expect(e.canEdit).toBe(false);
    expect(e.canDelete).toBe(true);

    const old = await createExpense(expenseSchema.parse({ amount: "900", description: "Electricity", spentOn: toDateParam(addDaysInZone(new Date(), -10)), paymentMethod: "UPI" }), owner);
    expect(toDateParam(new Date(old.spentOn))).toBe(toDateParam(addDaysInZone(new Date(), -10)));

    // The manager's list is forced to today even if a wider range is asked for.
    const mine = await listExpenses({ from: addDaysInZone(new Date(), -30), to: new Date() }, manager);
    expect(mine.items.map((x) => x.description)).toEqual(["Tea"]);

    const all = await listExpenses({ from: addDaysInZone(new Date(), -30), to: new Date() }, owner);
    expect(all.items.map((x) => x.description).sort()).toEqual(["Electricity", "Tea"]);
    expect(all.amount).toBe("1020.00");
    expect(await expenseTotal({ from: addDaysInZone(new Date(), -30), to: new Date() })).toBe("1020.00");
  });

  it("only the owner edits; the manager deletes only their own entries from today", async () => {
    const tea = (await listExpenses({}, owner)).items.find((x) => x.description === "Tea")!;
    await expect(updateExpense(tea.id, expenseSchema.parse({ amount: "1", description: "x" }), manager)).rejects.toThrow(/owner/i);
    const edited = await updateExpense(tea.id, expenseSchema.parse({ amount: "150", description: "Tea & snacks", spentOn: toDateParam(new Date()) }), owner);
    expect(edited.amount).toBe("150");
    expect(edited.spentOn).toBe(tea.spentOn); // same day keeps the time

    const others = await createExpense(expenseSchema.parse({ amount: "30", description: "Water" }), otherManager);
    await expect(deleteExpense(others.id, manager)).rejects.toThrow(/only entries you made today/i);
    await deleteExpense(others.id, otherManager);
    await deleteExpense(tea.id, owner);
    expect(await prisma.expense.count({ where: { id: { in: [tea.id, others.id] } } })).toBe(0);
    expect(expenseSchema.safeParse({ amount: "10", description: "" }).success).toBe(false);
  });
});
