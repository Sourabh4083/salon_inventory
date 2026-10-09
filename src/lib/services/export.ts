import "server-only";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import type { BillStatus, MovementType } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import { listProducts, type ProductSort } from "@/lib/services/products";
import { listBills } from "@/lib/services/billing";
import { getProfitReport } from "@/lib/services/profit";
import { getMoneyMovement, listMoneyEntries, type AccountMovement } from "@/lib/services/cashbook";
import { listMovements } from "@/lib/services/inventory";
import { listExpenses } from "@/lib/services/expenses";
import { getPurchaseReport } from "@/lib/services/orders";
import { listEmployees } from "@/lib/services/employees";
import { attendanceSummaries } from "@/lib/services/attendance";
import { isMonthParam, monthRange, resolveRange, toDateParam, toMonthParam } from "@/lib/dates";
import { formatDate, formatDateTime } from "@/lib/format";
import { MOVEMENT_LABEL, UNIT_LABEL, movementLabel } from "@/lib/constants";
import { fromPaise, toPaise } from "@/lib/money";
import type { StockStatus } from "@/lib/stock-status";

/**
 * Owner-only Excel downloads. Each export takes the same filters as the page it is
 * downloaded from and reuses that page's own list query, page by page, so the file
 * holds exactly the rows the owner was looking at — all of them, not just one page.
 */

export const EXPORT_KINDS = ["products", "bills", "sales-report", "expenses", "salaries", "stock-activity"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export type ExportFile = { fileName: string; body: Buffer };

type Row = Record<string, string | number | null>;
type Sheet = { name: string; rows: Row[] };

/** Safety cap: a list longer than this is cut off rather than exhausting the server. */
const MAX_ROWS = 50_000;

async function collect<T>(fetchPage: (page: number) => Promise<{ items: T[]; pageCount: number }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < MAX_ROWS; page++) {
    const res = await fetchPage(page);
    out.push(...res.items);
    if (page >= res.pageCount) break;
  }
  return out;
}

const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

function workbook(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = s.rows.length ? XLSX.utils.json_to_sheet(s.rows) : XLSX.utils.aoa_to_sheet([["No data"]]);
    // Size columns to their longest value so the file opens readable.
    const keys = s.rows.length ? Object.keys(s.rows[0]) : [];
    ws["!cols"] = keys.map((k) => ({ wch: Math.min(60, Math.max(k.length, ...s.rows.map((r) => String(r[k] ?? "").length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

type Params = Record<string, string | undefined>;

const STOCK_STATUSES = new Set<StockStatus>(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]);
const SORTS = new Set<ProductSort>(["name", "quantity", "price", "updated"]);
const BILL_STATUSES = new Set<BillStatus>(["COMPLETED", "CANCELLED"]);
const MOVEMENT_TYPES = new Set<MovementType>(Object.keys(MOVEMENT_LABEL) as MovementType[]);

async function productsSheets(p: Params): Promise<Sheet[]> {
  const archivedOnly = p.archived === "1";
  const stockStatus = STOCK_STATUSES.has(p.status as StockStatus) ? (p.status as StockStatus) : undefined;
  const sort = SORTS.has(p.sort as ProductSort) ? (p.sort as ProductSort) : "name";
  const items = await collect((page) =>
    listProducts({ search: p.q, categoryId: p.category || undefined, stockStatus: archivedOnly ? undefined : stockStatus, sort, archivedOnly, page, pageSize: 100 }),
  );
  return [
    {
      name: archivedOnly ? "Archived products" : "Products",
      rows: items.map((x) => ({
        "Product no.": x.productNumber,
        Name: x.name,
        Category: x.categoryName,
        SKU: x.sku,
        Barcode: x.barcode,
        Quantity: x.quantity,
        Unit: UNIT_LABEL[x.unit],
        "Stock status": x.stockStatus.replace(/_/g, " ").toLowerCase(),
        "Low-stock alert at": x.effectiveThreshold,
        "Cost price": num(x.costPrice),
        "Selling price": num(x.sellingPrice),
        "Stock value (cost)": x.costPrice ? Number(fromPaise(toPaise(x.costPrice) * x.quantity)) : null,
        Location: x.location,
        Status: x.status === "ACTIVE" ? "Active" : "Archived",
        "Last updated": formatDateTime(x.updatedAt),
      })),
    },
  ];
}

async function billsSheets(p: Params): Promise<Sheet[]> {
  const status = BILL_STATUSES.has(p.status as BillStatus) ? (p.status as BillStatus) : undefined;
  const range = p.range ? resolveRange({ range: p.range, from: p.from, to: p.to }) : null;
  const bills = await collect((page) => listBills({ search: p.q, status, from: range?.from, to: range?.to, page, pageSize: 100 }));
  return [
    {
      name: "Bills",
      rows: bills.map((b) => ({
        "Bill no.": b.billNumber,
        Date: formatDateTime(b.createdAt),
        Status: b.status === "COMPLETED" ? "Completed" : "Cancelled",
        Customer: b.customerName,
        Phone: b.customerPhone,
        Items: b.itemCount,
        Subtotal: Number(b.subtotal),
        Discount: Number(b.discount),
        Total: Number(b.total),
        Payment: b.payments.length ? [...new Set(b.payments.map((p) => p.method))].join(" + ") : "Pay later",
        Paid: Number(b.amountPaid),
        "Balance due": b.status === "COMPLETED" ? Number(b.balanceDue) : 0,
        "Billed by": b.createdByName,
        Notes: b.notes,
        "Cancelled reason": b.cancelReason,
      })),
    },
    {
      name: "Bill items",
      rows: bills.flatMap((b) =>
        b.items.map((i) => ({
          "Bill no.": b.billNumber,
          Date: formatDateTime(b.createdAt),
          Status: b.status === "COMPLETED" ? "Completed" : "Cancelled",
          Type: i.kind === "PRODUCT" ? "Product" : "Service",
          Item: i.name,
          Quantity: i.quantity,
          "Unit price": Number(i.unitPrice),
          "Line total": Number(i.lineTotal),
        })),
      ),
    },
  ];
}

async function salesReportSheets(p: Params, actor: SessionUser): Promise<Sheet[]> {
  const range = resolveRange(p);
  const [profit, expenses, purchases, movement, passbook] = await Promise.all([
    getProfitReport(range),
    collect((page) => listExpenses({ from: range.from, to: range.to, page, pageSize: 100 }, actor)),
    getPurchaseReport(range),
    getMoneyMovement(range),
    listMoneyEntries(range, 5000),
  ]);
  const { report } = profit;
  const moneyLine = (label: string, key: keyof AccountMovement) => ({ Figure: label, Cash: Number(movement.cash[key]), Bank: Number(movement.bank[key]), Total: Number(movement.total[key]) });
  return [
    {
      name: "Summary",
      rows: [
        { Figure: "From", Value: formatDate(range.from) },
        { Figure: "To", Value: formatDate(range.to) },
        { Figure: "Completed bills", Value: report.billCount },
        { Figure: "Cancelled bills", Value: report.cancelledCount },
        { Figure: "Sales", Value: Number(report.revenue) },
        { Figure: "Product sales", Value: Number(report.productRevenue) },
        { Figure: "Service sales", Value: Number(report.serviceRevenue) },
        { Figure: "Discounts given", Value: Number(report.discount) },
        { Figure: "Units sold", Value: report.unitsSold },
        { Figure: "Product cost", Value: Number(profit.productCost) },
        { Figure: "Shop expenses", Value: Number(profit.expenses) },
        { Figure: "Staff pay", Value: Number(profit.staffPay) },
        { Figure: "Money spent", Value: Number(profit.spent) },
        { Figure: "Profit (sales − money spent)", Value: Number(profit.profit) },
        { Figure: "Total received", Value: Number(profit.received) },
        { Figure: "Still to collect (unpaid bills)", Value: Number(report.toCollect) },
        { Figure: "Product purchases (received)", Value: Number(purchases.total) },
        { Figure: "Units received from orders", Value: purchases.units },
      ],
    },
    {
      name: "Money in and out",
      rows: [
        moneyLine("Received from customers", "received"),
        moneyLine("Shop expenses", "expenses"),
        moneyLine("Salary paid", "salary"),
        moneyLine("Advances given", "advances"),
        moneyLine("Stock bought", "stock"),
        moneyLine("Change (received − paid out)", "change"),
      ],
    },
    {
      name: "Passbook",
      rows: passbook.items.map((e) => ({ Date: formatDate(e.date), Entry: e.label, "Paid by": e.method, Account: e.account === "cash" ? "Cash" : "Bank", Amount: Number(e.amount) })),
    },
    { name: "By day", rows: report.byDay.map((d) => ({ Date: formatDate(d.date), Bills: d.billCount, Sales: Number(d.amount) })) },
    { name: "Payments received", rows: report.byPayment.map((x) => ({ Method: x.method, Payments: x.count, Amount: Number(x.amount) })) },
    { name: "Top products", rows: report.topProducts.map((x) => ({ Product: x.name, Quantity: x.quantity, Amount: Number(x.amount) })) },
    { name: "Top services", rows: report.topServices.map((x) => ({ Service: x.name, Quantity: x.quantity, Amount: Number(x.amount) })) },
    { name: "Expenses", rows: expenses.map(expenseRow) },
    { name: "Staff pay", rows: profit.staff.map((s) => ({ Employee: s.name, Days: s.days, "Days cut": s.cutDays, Amount: Number(s.amount) })) },
    {
      name: "Product purchases",
      rows: purchases.orders.map((o) => ({ Order: o.orderNumber, "Last received": formatDate(o.lastReceivedAt), Units: o.units, Amount: Number(o.amount) })),
    },
  ];
}

function expenseRow(e: Awaited<ReturnType<typeof listExpenses>>["items"][number]): Row {
  return { Date: formatDate(e.spentOn), "Spent on": e.description, Amount: Number(e.amount), "Paid by": e.paymentMethod, "Noted by": e.createdByName };
}

async function expensesSheets(p: Params, actor: SessionUser): Promise<Sheet[]> {
  const range = resolveRange(p);
  const expenses = await collect((page) => listExpenses({ from: range.from, to: range.to, page, pageSize: 100 }, actor));
  return [{ name: "Expenses", rows: expenses.map(expenseRow) }];
}

async function salariesSheets(p: Params, actor: SessionUser): Promise<Sheet[]> {
  const month = isMonthParam(p.month) ? p.month : toMonthParam();
  const range = monthRange(month);
  const [employees, advances, payments, attendance] = await Promise.all([
    collect((page) => listEmployees({ status: "all", page, pageSize: 100 }, actor)),
    prisma.employeeAdvance.findMany({
      where: { takenOn: { gte: range.from, lte: range.to } },
      orderBy: [{ takenOn: "asc" }, { createdAt: "asc" }],
      include: { employee: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    prisma.salaryPayment.findMany({
      where: { OR: [{ periodMonth: month }, { periodMonth: null, paidOn: { gte: range.from, lte: range.to } }] },
      orderBy: { paidOn: "asc" },
      include: { employee: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    attendanceSummaries(month, actor),
  ]);
  const attendanceBy = new Map(attendance.map((a) => [a.employeeId, a]));
  const advanceBy = new Map<string, number>();
  for (const a of advances) advanceBy.set(a.employeeId, (advanceBy.get(a.employeeId) ?? 0) + toPaise(a.amount.toString()));
  const paidBy = new Map<string, number>();
  for (const s of payments) paidBy.set(s.employeeId, (paidBy.get(s.employeeId) ?? 0) + toPaise(s.amount.toString()));

  return [
    {
      name: `Summary ${month}`,
      rows: employees
        .filter((e) => e.isActive || advanceBy.has(e.id) || paidBy.has(e.id))
        .map((e) => {
          const salary = toPaise(e.monthlySalary);
          const taken = advanceBy.get(e.id) ?? 0;
          const att = attendanceBy.get(e.id);
          const cut = toPaise(att?.deduction);
          return {
            Employee: e.name,
            Designation: e.designation,
            "Monthly salary": e.monthlySalary ? Number(e.monthlySalary) : null,
            Present: att ? att.present : null,
            Absent: att ? att.absent : null,
            "Half days": att ? att.halfDay : null,
            Holidays: att ? att.holiday : null,
            "Paid leave": att ? att.leavePaid : null,
            "Unpaid leave": att ? att.leaveUnpaid + att.leavePending : null,
            "Not marked": att ? att.notMarked : null,
            "Days cut": att ? att.cutDays : null,
            "Pay cut for days off": Number(fromPaise(cut)),
            "Advances taken": Number(fromPaise(taken)),
            "To pay (salary − cut − advances)": e.monthlySalary ? Number(fromPaise(salary - cut - taken)) : null,
            "Salary paid": Number(fromPaise(paidBy.get(e.id) ?? 0)),
            Status: e.isActive ? "Working" : "Left",
          };
        }),
    },
    {
      name: "Advances",
      rows: advances.map((a) => ({ Date: formatDate(a.takenOn), Employee: a.employee.name, Amount: Number(a.amount), "Paid by": a.paymentMethod, Note: a.note, "Noted by": a.createdBy.name })),
    },
    {
      name: "Salary payments",
      rows: payments.map((s) => ({
        "Paid on": formatDate(s.paidOn),
        Employee: s.employee.name,
        "For month": s.periodMonth,
        "Cut for days off": s.absenceDeducted ? Number(s.absenceDeducted) : null,
        "Advances deducted": s.advanceDeducted ? Number(s.advanceDeducted) : null,
        "Amount paid": Number(s.amount),
        Method: s.paymentMethod,
        Note: s.note,
        "Recorded by": s.createdBy.name,
      })),
    },
  ];
}

async function stockActivitySheets(p: Params): Promise<Sheet[]> {
  const type = MOVEMENT_TYPES.has(p.type as MovementType) ? (p.type as MovementType) : undefined;
  const moves = await collect((page) => listMovements({ type, page, pageSize: 100 }));
  return [
    {
      name: "Stock activity",
      rows: moves.map((m) => ({
        Date: formatDateTime(m.createdAt),
        "Product no.": m.productNumber,
        Product: m.productName,
        Change: movementLabel(m.type, m.billId),
        Quantity: m.quantityChange,
        Before: m.previousQuantity,
        After: m.newQuantity,
        "Unit cost": num(m.unitCost),
        Note: m.note,
        By: m.performedByName,
      })),
    },
  ];
}

/** The caller must have checked the `data.export` permission. */
export async function buildExport(kind: ExportKind, params: Params, actor: SessionUser): Promise<ExportFile> {
  const sheets =
    kind === "products"
      ? await productsSheets(params)
      : kind === "bills"
        ? await billsSheets(params)
        : kind === "sales-report"
          ? await salesReportSheets(params, actor)
          : kind === "expenses"
            ? await expensesSheets(params, actor)
            : kind === "salaries"
              ? await salariesSheets(params, actor)
              : await stockActivitySheets(params);
  return { fileName: `${kind}-${toDateParam(new Date())}.xlsx`, body: workbook(sheets) };
}
