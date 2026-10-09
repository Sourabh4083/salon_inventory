import { prisma } from "@/lib/db";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/services/audit";
import { getSettings } from "@/lib/services/settings";
import { fromPaise, toPaise } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { startOfDay, toDateParam } from "@/lib/dates";
import type { SessionUser } from "@/lib/auth/session";
import type { BalancesData, CashDepositData } from "@/lib/validation/schemas";

/**
 * Where the shop's money is. Two accounts: the cash drawer (Cash) and the bank (UPI and
 * Card). Money received from customers adds to an account; expenses, salaries, advances
 * and stock paid for on receipt take from it. Cash the owner carries to the bank moves
 * from one account to the other. The owner counts both once, and the running balances
 * follow every entry made after that.
 */

export type Account = "cash" | "bank";

export function accountOf(method: PaymentMethod): Account {
  return method === "CASH" ? "cash" : "bank";
}

export type AccountMovement = {
  received: string;
  expenses: string;
  salary: string;
  advances: string;
  stock: string;
  /** Everything paid out. */
  out: string;
  /** Cash carried to the bank: minus on cash, plus on bank, nothing on the total. */
  moved: string;
  /** received − out + moved */
  change: string;
};

export type MoneyMovement = Record<Account | "total", AccountMovement>;

/** `from`/`to` bound the entry's own date; `recordedAfter` also needs it typed in after that moment. */
type Window = { from: Date; to?: Date; recordedAfter?: Date };

const dated = (w: Window) => ({ gte: w.from, ...(w.to ? { lte: w.to } : {}) });
const recorded = (w: Window) => (w.recordedAfter ? { createdAt: { gt: w.recordedAfter } } : {});
// A stock movement has only the one date.
const stockWhere = (w: Window) => ({
  type: "STOCK_IN" as const,
  paymentMethod: { not: null },
  unitCost: { not: null },
  createdAt: { ...dated(w), ...(w.recordedAfter ? { gt: w.recordedAfter } : {}) },
});

type Lines = { received: number; expenses: number; salary: number; advances: number; stock: number; moved: number };
const noLines = (): Lines => ({ received: 0, expenses: 0, salary: 0, advances: 0, stock: 0, moved: 0 });

function toMovement(l: Lines): AccountMovement {
  const out = l.expenses + l.salary + l.advances + l.stock;
  return {
    received: fromPaise(l.received),
    expenses: fromPaise(l.expenses),
    salary: fromPaise(l.salary),
    advances: fromPaise(l.advances),
    stock: fromPaise(l.stock),
    out: fromPaise(out),
    moved: fromPaise(l.moved),
    change: fromPaise(l.received - out + l.moved),
  };
}

async function movement(w: Window): Promise<MoneyMovement> {
  const [received, expenses, salary, advances, stock, deposits] = await Promise.all([
    prisma.billPayment.groupBy({ by: ["method"], where: { paidAt: dated(w), ...recorded(w), bill: { status: "COMPLETED" } }, _sum: { amount: true } }),
    prisma.expense.groupBy({ by: ["paymentMethod"], where: { spentOn: dated(w), ...recorded(w) }, _sum: { amount: true } }),
    // The amount is what was handed over, after advances and cuts, so advances are not counted twice.
    prisma.salaryPayment.groupBy({ by: ["paymentMethod"], where: { paidOn: dated(w), ...recorded(w) }, _sum: { amount: true } }),
    prisma.employeeAdvance.groupBy({ by: ["paymentMethod"], where: { takenOn: dated(w), ...recorded(w) }, _sum: { amount: true } }),
    prisma.stockMovement.findMany({ where: stockWhere(w), select: { paymentMethod: true, quantityChange: true, unitCost: true } }),
    prisma.cashDeposit.aggregate({ where: { movedOn: dated(w), ...recorded(w) }, _sum: { amount: true } }),
  ]);
  const by: Record<Account, Lines> = { cash: noLines(), bank: noLines() };
  const paise = (v: { toString(): string } | null) => toPaise(v?.toString() ?? "0");
  for (const r of received) by[accountOf(r.method)].received += paise(r._sum.amount);
  for (const r of expenses) by[accountOf(r.paymentMethod)].expenses += paise(r._sum.amount);
  for (const r of salary) by[accountOf(r.paymentMethod)].salary += paise(r._sum.amount);
  for (const r of advances) by[accountOf(r.paymentMethod)].advances += paise(r._sum.amount);
  for (const r of stock) by[accountOf(r.paymentMethod!)].stock += paise(r.unitCost) * r.quantityChange;
  by.cash.moved = -paise(deposits._sum.amount);
  by.bank.moved = paise(deposits._sum.amount);

  const total = noLines();
  for (const k of Object.keys(total) as (keyof Lines)[]) total[k] = by.cash[k] + by.bank[k];
  return { cash: toMovement(by.cash), bank: toMovement(by.bank), total: toMovement(total) };
}

/** Money in and out over a period, by the date of each entry. */
export function getMoneyMovement(range: { from: Date; to: Date }): Promise<MoneyMovement> {
  return movement(range);
}

export type Balances = { cash: string; bank: string; total: string; openingCash: string; openingBank: string; openingAt: string };

/**
 * What should be in the drawer and the bank right now, or null until the owner has set
 * a starting amount. Counts what was entered after that moment and is dated that day or
 * later: an entry made before the count is already in it, and so is one back-dated to
 * an earlier day.
 */
export async function getBalances(): Promise<Balances | null> {
  const row = await prisma.businessSettings.findUnique({ where: { id: "default" }, select: { openingCash: true, openingBank: true, openingAt: true } });
  if (!row?.openingAt) return null;
  const m = await movement({ from: startOfDay(row.openingAt), recordedAfter: row.openingAt });
  const openingCash = toPaise(row.openingCash?.toString());
  const openingBank = toPaise(row.openingBank?.toString());
  const cash = openingCash + toPaise(m.cash.change);
  const bank = openingBank + toPaise(m.bank.change);
  return {
    cash: fromPaise(cash),
    bank: fromPaise(bank),
    total: fromPaise(cash + bank),
    openingCash: fromPaise(openingCash),
    openingBank: fromPaise(openingBank),
    openingAt: row.openingAt.toISOString(),
  };
}

/**
 * Owner: what is in the drawer and the bank right now. Used once to start, and again
 * whenever the real amounts differ (cash taken to the bank, money taken home): the
 * count simply restarts from here.
 */
export async function setBalances(input: BalancesData, actor: SessionUser, now = new Date()): Promise<void> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can set the balances.", "FORBIDDEN");
  await getSettings(); // makes sure the settings row exists
  await prisma.$transaction(async (tx) => {
    await tx.businessSettings.update({ where: { id: "default" }, data: { openingCash: input.cash, openingBank: input.bank, openingAt: now } });
    await recordAudit(tx, {
      action: "BALANCES_SET",
      entityType: "BusinessSettings",
      entityId: "default",
      summary: `Balances set: cash ${input.cash}, bank ${input.bank}`,
      metadata: { cash: input.cash, bank: input.bank },
      actorId: actor.id,
    });
  });
}

/** Owner: carries cash from the drawer to the bank. Cash goes down, Bank goes up by the same amount. */
export async function moveCashToBank(input: CashDepositData, actor: SessionUser, now = new Date()): Promise<void> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can move cash to the bank.", "FORBIDDEN");
  const balances = await getBalances();
  if (!balances) throw new AppError("Set your cash and bank balance first.");
  if (toPaise(input.amount) > toPaise(balances.cash)) {
    const { currencySymbol } = await getSettings();
    throw new AppError(`Only ${formatMoney(balances.cash, currencySymbol)} is in the drawer.`);
  }
  await prisma.$transaction(async (tx) => {
    const deposit = await tx.cashDeposit.create({ data: { amount: input.amount, movedOn: now, createdById: actor.id } });
    await recordAudit(tx, {
      action: "CASH_TO_BANK",
      entityType: "CashDeposit",
      entityId: deposit.id,
      summary: `Moved ${input.amount} from cash to bank`,
      metadata: { amount: input.amount },
      actorId: actor.id,
    });
  });
}

/** Owner: undoes a move typed in by mistake; the cash is back in the drawer. */
export async function deleteCashDeposit(id: string, actor: SessionUser): Promise<void> {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can remove this.", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    const deposit = await tx.cashDeposit.findUnique({ where: { id } });
    if (!deposit) throw new AppError("That entry no longer exists.", "NOT_FOUND");
    await tx.cashDeposit.delete({ where: { id } });
    await recordAudit(tx, {
      action: "CASH_TO_BANK_DELETED",
      entityType: "CashDeposit",
      entityId: id,
      summary: `Removed the move of ${deposit.amount.toFixed(2)} from cash to bank`,
      metadata: { amount: deposit.amount.toFixed(2) },
      actorId: actor.id,
    });
  });
}

export type MoneyEntry = {
  key: string;
  date: string;
  label: string;
  account: Account;
  /** Null for cash moved to the bank, which is not a payment. */
  method: PaymentMethod | null;
  /** Positive for money in, negative for money out. */
  amount: string;
  /** Where the line opens; null when there is nothing to open. */
  href: string | null;
  /** Set on the two lines of a cash-to-bank move, so the owner can remove it. */
  depositId?: string;
};

/** The passbook: every payment in or out in the period, newest first. */
export async function listMoneyEntries(range: { from: Date; to: Date }, limit = 200): Promise<{ items: MoneyEntry[]; more: boolean }> {
  const w: Window = range;
  const [received, expenses, salary, advances, stock, deposits] = await Promise.all([
    prisma.billPayment.findMany({
      where: { paidAt: dated(w), bill: { status: "COMPLETED" } },
      orderBy: { paidAt: "desc" },
      take: limit + 1,
      select: { id: true, amount: true, method: true, paidAt: true, bill: { select: { id: true, billNumber: true, customerName: true } } },
    }),
    prisma.expense.findMany({ where: { spentOn: dated(w) }, orderBy: { spentOn: "desc" }, take: limit + 1, select: { id: true, amount: true, paymentMethod: true, spentOn: true, description: true } }),
    prisma.salaryPayment.findMany({
      where: { paidOn: dated(w) },
      orderBy: { paidOn: "desc" },
      take: limit + 1,
      select: { id: true, amount: true, paymentMethod: true, paidOn: true, employeeId: true, employee: { select: { name: true } } },
    }),
    prisma.employeeAdvance.findMany({
      where: { takenOn: dated(w) },
      orderBy: { takenOn: "desc" },
      take: limit + 1,
      select: { id: true, amount: true, paymentMethod: true, takenOn: true, employeeId: true, employee: { select: { name: true } } },
    }),
    prisma.stockMovement.findMany({
      where: stockWhere(w),
      select: { paymentMethod: true, quantityChange: true, unitCost: true, createdAt: true, purchaseOrder: { select: { id: true, orderNumber: true } } },
    }),
    prisma.cashDeposit.findMany({ where: { movedOn: dated(w) }, orderBy: { movedOn: "desc" }, take: limit + 1, select: { id: true, amount: true, movedOn: true } }),
  ]);

  type Row = Omit<MoneyEntry, "date" | "amount" | "account"> & { at: Date; paise: number; account?: Account };
  const rows: Row[] = [
    ...received.map((r) => ({
      key: `in-${r.id}`,
      at: r.paidAt,
      label: `${r.bill.billNumber}${r.bill.customerName ? ` · ${r.bill.customerName}` : ""}`,
      method: r.method,
      paise: toPaise(r.amount.toString()),
      href: `/billing/${r.bill.id}`,
    })),
    ...expenses.map((e) => ({ key: `exp-${e.id}`, at: e.spentOn, label: e.description, method: e.paymentMethod, paise: -toPaise(e.amount.toString()), href: "/expenses" })),
    ...salary.map((s) => ({ key: `sal-${s.id}`, at: s.paidOn, label: `Salary · ${s.employee.name}`, method: s.paymentMethod, paise: -toPaise(s.amount.toString()), href: `/employees/${s.employeeId}` })),
    ...advances.map((a) => ({ key: `adv-${a.id}`, at: a.takenOn, label: `Advance · ${a.employee.name}`, method: a.paymentMethod, paise: -toPaise(a.amount.toString()), href: `/employees/${a.employeeId}` })),
  ];
  // One line per delivery: everything received on an order on a day, paid the same way.
  const deliveries = new Map<string, Row>();
  for (const m of stock) {
    if (!m.purchaseOrder) continue;
    const key = `stock-${m.purchaseOrder.id}-${m.paymentMethod}-${toDateParam(m.createdAt)}`;
    const cur = deliveries.get(key) ?? { key, at: m.createdAt, label: `Stock · ${m.purchaseOrder.orderNumber}`, method: m.paymentMethod!, paise: 0, href: `/orders/${m.purchaseOrder.id}` };
    cur.paise -= toPaise(m.unitCost!.toString()) * m.quantityChange;
    if (m.createdAt > cur.at) cur.at = m.createdAt;
    deliveries.set(key, cur);
  }
  rows.push(...deliveries.values());
  // Like a real passbook: one line leaving the drawer, one arriving in the bank.
  for (const d of deposits) {
    const paise = toPaise(d.amount.toString());
    rows.push({ key: `dep-out-${d.id}`, at: d.movedOn, label: "Cash moved to bank", method: null, account: "cash", paise: -paise, href: null, depositId: d.id });
    rows.push({ key: `dep-in-${d.id}`, at: d.movedOn, label: "Cash deposited", method: null, account: "bank", paise, href: null, depositId: d.id });
  }
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    items: rows.slice(0, limit).map(({ at, paise, account, ...r }) => ({ ...r, date: at.toISOString(), account: account ?? accountOf(r.method!), amount: fromPaise(paise) })),
    more: rows.length > limit,
  };
}
