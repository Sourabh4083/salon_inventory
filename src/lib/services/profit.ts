import { prisma } from "@/lib/db";
import { fromPaise, toPaise } from "@/lib/money";
import { getSalesReport, type SalesReport } from "@/lib/services/billing";
import { expenseTotal } from "@/lib/services/expenses";
import { staffPayForRange, type StaffPayRow } from "@/lib/services/attendance";

/**
 * The owner's one sum: Sales − Money spent = Profit, where money spent is the cost of
 * the products sold, the shop's expenses and the staff's pay for those days. Stock
 * bought is left out: it sits on the shelf until it is sold, and is counted then.
 */
export type ProfitReport = {
  report: SalesReport;
  sales: string;
  /** Money that actually came in, which differs from sales when a bill is paid later. */
  received: string;
  productCost: string;
  expenses: string;
  staffPay: string;
  staff: StaffPayRow[];
  spent: string;
  profit: string;
  /** Working employees with no salary typed in, whom staff pay can't include. */
  staffWithoutSalary: number;
};

export async function getProfitReport(range: { from: Date; to: Date }, now = new Date()): Promise<ProfitReport> {
  const [report, expenses, staffPay, staffWithoutSalary] = await Promise.all([
    getSalesReport(range),
    expenseTotal(range),
    staffPayForRange(range, now),
    prisma.employee.count({ where: { isActive: true, monthlySalary: null } }),
  ]);
  const spent = toPaise(report.cost) + toPaise(expenses) + toPaise(staffPay.total);
  return {
    report,
    sales: report.revenue,
    received: fromPaise(report.byPayment.reduce((n, p) => n + toPaise(p.amount), 0)),
    productCost: report.cost,
    expenses,
    staffPay: staffPay.total,
    staff: staffPay.staff,
    spent: fromPaise(spent),
    profit: fromPaise(toPaise(report.revenue) - spent),
    staffWithoutSalary,
  };
}
