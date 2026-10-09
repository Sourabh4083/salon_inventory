import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/lib/services/products";
import { createBill } from "@/lib/services/billing";
import { createEmployee } from "@/lib/services/employees";
import { createExpense } from "@/lib/services/expenses";
import { daysInMonth, staffPayForRange } from "@/lib/services/attendance";
import { getDashboardStats } from "@/lib/services/inventory";
import { getProfitReport } from "@/lib/services/profit";
import { billCreateSchema, employeeSchema, expenseSchema, productCreateSchema } from "@/lib/validation/schemas";
import { endOfDay, monthRange, startOfDay, toDateParam } from "@/lib/dates";
import { addDaysInZone, zonedDate } from "@/lib/timezone";
import { fromPaise, toPaise } from "@/lib/money";
import { seedBasics } from "./helpers";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let categoryId = "";

// A fixed past month, so the sums don't depend on the day the tests run: June has 30 days.
const MONTH = "2026-06";
const june = (day: number) => zonedDate(2026, 6, day);
const juneRange = (from: number, to: number) => ({ from: june(from), to: endOfDay(june(to)) });

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  categoryId = s.category.id;
});

function employee(overrides: Record<string, unknown> = {}) {
  return createEmployee(employeeSchema.parse({ name: "Sunita", monthlySalary: "15000", joinedAt: "2025-01-01", ...overrides }), owner);
}

async function mark(employeeId: string, day: number, status: AttendanceStatus, leavePaid: boolean | null = null) {
  await prisma.attendance.create({ data: { employeeId, date: june(day), status, leavePaid, markedById: owner.id } });
}

describe("staff pay for a period", () => {
  it("counts one day's pay for each day, a whole month as the whole salary", async () => {
    const e = await employee();
    expect(daysInMonth(MONTH)).toBe(30);
    expect(await staffPayForRange(juneRange(10, 10))).toEqual({ total: "500.00", staff: [{ employeeId: e.id, name: "Sunita", days: 1, cutDays: 0, amount: "500.00" }] });
    expect((await staffPayForRange(monthRange(MONTH))).total).toBe("15000.00");
  });

  it("cuts absent days, unpaid and undecided leave, and half of a half day", async () => {
    const e = await employee();
    await mark(e.id, 1, "PRESENT");
    await mark(e.id, 2, "ABSENT");
    await mark(e.id, 3, "HALF_DAY");
    await mark(e.id, 4, "HOLIDAY");
    await mark(e.id, 5, "LEAVE", null);
    await mark(e.id, 6, "LEAVE", false);
    await mark(e.id, 7, "LEAVE", true);
    // Day 8 is not marked and is not cut.
    const pay = await staffPayForRange(juneRange(1, 8));
    // 8 days less 3.5 cut = 4.5 days at 500.
    expect(pay.staff[0]).toMatchObject({ days: 8, cutDays: 3.5, amount: "2250.00" });
    expect(pay.total).toBe("2250.00");
  });

  it("starts at the joining day, stops at the leaving day and skips people with no salary", async () => {
    const joined = await employee({ name: "Joined", joinedAt: "2026-06-21" });
    const left = await employee({ name: "Left" });
    await prisma.employee.update({ where: { id: left.id }, data: { isActive: false, leftAt: june(5) } });
    await employee({ name: "No Salary", monthlySalary: "" });

    const pay = await staffPayForRange(monthRange(MONTH));
    expect(pay.staff).toEqual([
      { employeeId: joined.id, name: "Joined", days: 10, cutDays: 0, amount: "5000.00" },
      { employeeId: left.id, name: "Left", days: 5, cutDays: 0, amount: "2500.00" },
    ]);
    expect(pay.total).toBe("7500.00");
    expect((await staffPayForRange(juneRange(6, 20))).staff).toEqual([]);
  });

  it("divides each month by its own length and leaves out days still to come", async () => {
    await employee();
    // 30 June (15000 / 30) + 1 July (15000 / 31)
    const pay = await staffPayForRange({ from: june(30), to: endOfDay(zonedDate(2026, 7, 1)) });
    expect(pay.total).toBe(fromPaise(50000 + Math.round(1500000 / 31)));

    const today = startOfDay(new Date());
    const upToToday = await staffPayForRange({ from: today, to: endOfDay(today) });
    const withFuture = await staffPayForRange({ from: today, to: endOfDay(addDaysInZone(today, 10)) });
    expect(withFuture).toEqual(upToToday);
    expect(upToToday.staff[0].days).toBe(1);
  });
});

describe("profit report", () => {
  it("is sales less product cost, shop expenses and staff pay", async () => {
    await employee({ monthlySalary: "9300" });
    const product = (overrides: Record<string, unknown>) => createProduct(productCreateSchema.parse({ name: "X", categoryId, startingQuantity: 10, ...overrides }), owner);
    const serum = await product({ name: "Serum", sellingPrice: "500", costPrice: "300" });
    const clip = await product({ name: "Clip", sellingPrice: "50" });

    await createBill(
      billCreateSchema.parse({
        items: [
          { kind: "PRODUCT", productId: serum.id, quantity: 2, unitPrice: "500" },
          { kind: "PRODUCT", productId: clip.id, quantity: 3, unitPrice: "50" },
          { kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "850" },
        ],
        paymentMethod: "CASH",
      }),
      manager,
    );
    // A pay-later bill is a sale, but no money has come in yet.
    await createBill(
      billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Styling", quantity: 1, unitPrice: "1000" }], customerName: "Ravi", customerPhone: "9876543210", payLater: true }),
      manager,
    );
    await createExpense(expenseSchema.parse({ amount: "120", description: "Tea" }), manager);

    const now = new Date();
    const range = { from: startOfDay(now), to: endOfDay(now) };
    const p = await getProfitReport(range);
    const oneDay = Math.round(930000 / daysInMonth(toDateParam(now).slice(0, 7)));

    expect(p.sales).toBe("3000.00");
    expect(p.received).toBe("2000.00");
    expect(p.productCost).toBe("600.00");
    expect(p.expenses).toBe("120.00");
    expect(p.staffPay).toBe(fromPaise(oneDay));
    expect(p.spent).toBe(fromPaise(60000 + 12000 + oneDay));
    expect(toPaise(p.sales) - toPaise(p.spent)).toBe(toPaise(p.profit));
    expect(p.staffWithoutSalary).toBe(0);

    expect(p.report.uncostedUnitsSold).toBe(3);
    expect(p.report.soldProducts).toEqual([
      { productId: serum.id, name: "Serum", quantity: 2, amount: "1000.00", cost: "600.00" },
      { productId: clip.id, name: "Clip", quantity: 3, amount: "150.00", cost: "0.00" },
    ]);
    expect(p.report.soldProducts.reduce((n, x) => n + toPaise(x.cost), 0)).toBe(toPaise(p.productCost));
  });

  it("counts working employees with no salary set", async () => {
    await employee({ name: "No Salary", monthlySalary: "" });
    const now = new Date();
    expect((await getProfitReport({ from: startOfDay(now), to: endOfDay(now) })).staffWithoutSalary).toBe(1);
  });
});

describe("stock value on the dashboard", () => {
  it("is quantity x cost price over the products that have one", async () => {
    const product = (overrides: Record<string, unknown>) => createProduct(productCreateSchema.parse({ name: "X", categoryId, ...overrides }), owner);
    await product({ name: "Costed", costPrice: "120.50", startingQuantity: 4 });
    await product({ name: "No Cost", startingQuantity: 7 });
    await product({ name: "Empty", costPrice: "999", startingQuantity: 0 });
    expect((await getDashboardStats()).stockValue).toBe("482.00");
  });
});
