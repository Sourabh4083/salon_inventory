import Link from "next/link";
import { ArrowRight, Ban, Banknote, HandCoins, Landmark, Package, Scissors, Truck, Users, Wallet } from "lucide-react";
import type { ProfitReport } from "@/lib/services/profit";
import type { AccountMovement, Balances, MoneyEntry, MoneyMovement } from "@/lib/services/cashbook";
import { MoneyBalanceForm } from "@/components/app/money-balance-form";
import { CashToBankForm, DeleteCashDeposit } from "@/components/app/cash-to-bank-form";
import type { ExpensePage } from "@/lib/services/expenses";
import type { PurchaseReport } from "@/lib/services/orders";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { fromPaise, toPaise } from "@/lib/money";
import { PAYMENT_LABEL } from "@/components/app/bill-badges";
import { cn } from "@/lib/utils";

/** The details behind each of the three figures on the owner's report. */

type Icon = React.ComponentType<{ className?: string }>;

function Panel({ title, icon: Icon, total, note, children, className }: { title: string; icon: Icon; total?: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-xs", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading text-lg">
          <Icon className="size-4.5 text-primary" /> {title}
        </h2>
        {total ? <span className="text-lg font-semibold tabular-nums">{total}</span> : null}
      </div>
      {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{children}</p>;
}

/* ---------- Sales ---------- */

export function SalesView({ p, sym, billsHref }: { p: ProfitReport; sym: string; billsHref: string }) {
  const { report } = p;
  const money = (v: string) => formatMoney(v, sym);
  const maxDay = Math.max(1, ...report.byDay.map((d) => toPaise(d.amount)));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Scissors className="size-4" /> Services
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(report.serviceRevenue)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Package className="size-4" /> Products · {formatNumber(report.unitsSold)} units
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(report.productRevenue)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border bg-card p-5 shadow-xs xl:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg">Sales by day</h2>
            <Link href={billsHref} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              See all bills <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {report.byDay.length === 0 ? (
            <Empty>No completed bills in this period.</Empty>
          ) : (
            <ul className="mt-4 space-y-2">
              {report.byDay.map((d) => {
                const pct = Math.max(2, Math.round((toPaise(d.amount) / maxDay) * 100));
                return (
                  <li key={d.date} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{formatDate(d.date)}</span>
                    <span className="h-6 overflow-hidden rounded-md bg-muted">
                      <span className="block h-full rounded-md bg-primary/80" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{money(d.amount)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {d.billCount} {d.billCount === 1 ? "bill" : "bills"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Panel title="Money received" icon={Banknote} note="Money that came in during this period, including dues collected on older bills.">
          <ul className="mt-4 divide-y text-sm">
            {report.byPayment.map((x) => (
              <li key={x.method} className="flex items-center justify-between py-2.5">
                <span>
                  {PAYMENT_LABEL[x.method]}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {x.count} {x.count === 1 ? "payment" : "payments"}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{money(x.amount)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between py-2.5 font-semibold">
              <span>Total received</span>
              <span className="tabular-nums">{money(p.received)}</span>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-1.5 text-orange-700 dark:text-orange-300">
                <HandCoins className="size-3.5" /> Still to collect
                <span className="text-xs text-muted-foreground">
                  {report.unpaidCount} {report.unpaidCount === 1 ? "bill" : "bills"}
                </span>
              </span>
              {report.unpaidCount > 0 ? (
                <Link href="/billing?status=UNPAID" className="font-medium text-orange-700 tabular-nums hover:underline dark:text-orange-300">
                  {money(report.toCollect)}
                </Link>
              ) : (
                <span className="tabular-nums">{money(report.toCollect)}</span>
              )}
            </li>
            <li className="flex items-center justify-between py-2.5 text-muted-foreground">
              <span>Discounts given</span>
              <span className="tabular-nums">− {money(report.discount)}</span>
            </li>
            <li className="flex items-center justify-between py-2.5 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Ban className="size-3.5" /> Cancelled bills
              </span>
              <span className="tabular-nums">{report.cancelledCount}</span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TopList
          title="Top products"
          icon={Package}
          rows={report.topProducts.map((x) => ({ key: x.productId ?? x.name, name: x.name, quantity: x.quantity, amount: money(x.amount), href: x.productId ? `/inventory/${x.productId}` : undefined }))}
          empty="No products sold in this period."
        />
        <TopList title="Top services" icon={Scissors} rows={report.topServices.map((s) => ({ key: s.name, name: s.name, quantity: s.quantity, amount: money(s.amount) }))} empty="No services billed in this period." />
      </div>
    </div>
  );
}

function TopList({ title, icon, rows, empty }: { title: string; icon: Icon; rows: { key: string; name: string; quantity: number; amount: string; href?: string }[]; empty: string }) {
  return (
    <Panel title={title} icon={icon}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ol className="mt-4 divide-y text-sm">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-3 py-2.5">
              <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.href ? <Link href={r.href} className="hover:underline">{r.name}</Link> : r.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">× {r.quantity}</span>
              <span className="w-24 text-right font-medium tabular-nums">{r.amount}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ---------- Money spent ---------- */

export function SpentView({ p, sym, expenses, purchases, expensesHref }: { p: ProfitReport; sym: string; expenses: ExpensePage; purchases: PurchaseReport; expensesHref: string }) {
  const money = (v: string) => formatMoney(v, sym);
  const { report } = p;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Product cost" icon={Package} total={money(p.productCost)} note="What the products you sold cost you to buy.">
          {report.soldProducts.length === 0 ? (
            <Empty>No products sold in this period.</Empty>
          ) : (
            <ul className="mt-4 divide-y text-sm">
              {report.soldProducts.map((x) => (
                <li key={x.productId ?? x.name} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{x.productId ? <Link href={`/inventory/${x.productId}`} className="hover:underline">{x.name}</Link> : x.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">× {formatNumber(x.quantity)}</span>
                  <span className="w-24 text-right font-medium tabular-nums">{money(x.cost)}</span>
                </li>
              ))}
            </ul>
          )}
          {report.uncostedUnitsSold > 0 ? (
            <Warning>
              {formatNumber(report.uncostedUnitsSold)} {report.uncostedUnitsSold === 1 ? "unit was" : "units were"} sold without a cost price, so profit looks higher than it is.
            </Warning>
          ) : null}
        </Panel>

        <Panel title="Shop expenses" icon={Wallet} total={money(p.expenses)} note="Day-to-day spending noted on the Expenses page.">
          {expenses.items.length === 0 ? (
            <Empty>No expenses in this period.</Empty>
          ) : (
            <ul className="mt-4 divide-y text-sm">
              {expenses.items.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.description}</span>
                    <span className="block text-xs text-muted-foreground">{formatDate(e.spentOn)}</span>
                  </span>
                  <span className="w-24 text-right font-medium tabular-nums">{money(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={expensesHref} className="mt-3 flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            {expenses.total > expenses.items.length ? `See all ${formatNumber(expenses.total)} expenses` : "Open Expenses"} <ArrowRight className="size-3.5" />
          </Link>
        </Panel>

        <Panel title="Staff pay" icon={Users} total={money(p.staffPay)} note="Each employee's salary for these days (monthly salary ÷ days in the month), less the cut for absent days.">
          {p.staff.length === 0 ? (
            <Empty>No employee has a salary set.</Empty>
          ) : (
            <ul className="mt-4 divide-y text-sm">
              {p.staff.map((s) => (
                <li key={s.employeeId} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <Link href={`/employees/${s.employeeId}`} className="block truncate font-medium hover:underline">
                      {s.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {formatNumber(s.days)} {s.days === 1 ? "day" : "days"}
                      {s.cutDays > 0 ? ` · ${formatNumber(s.cutDays)} cut` : ""}
                    </span>
                  </span>
                  <span className="w-24 text-right font-medium tabular-nums">{money(s.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {p.staffWithoutSalary > 0 ? (
            <Warning>
              {formatNumber(p.staffWithoutSalary)} {p.staffWithoutSalary === 1 ? "employee has" : "employees have"} no salary set, so staff pay is too low.
            </Warning>
          ) : null}
        </Panel>
      </div>

      <Panel title="Stock bought" icon={Truck} total={money(purchases.total)} note="Not counted in profit — this stock is on your shelf until it is sold. Counted on the day the goods arrived, at the order's cost price.">
        {purchases.orders.length === 0 ? (
          <Empty>No order deliveries in this period.</Empty>
        ) : (
          <ul className="mt-4 divide-y text-sm">
            {purchases.orders.map((o) => (
              <li key={o.orderId} className="flex items-center gap-3 py-2.5">
                <Link href={`/orders/${o.orderId}`} className="font-medium hover:underline">
                  {o.orderNumber}
                </Link>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Received {formatDate(o.lastReceivedAt)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">× {formatNumber(o.units)}</span>
                <span className="w-24 text-right font-medium tabular-nums">{money(o.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {purchases.uncostedUnits > 0 ? (
          <Warning>
            {formatNumber(purchases.uncostedUnits)} {purchases.uncostedUnits === 1 ? "unit was" : "units were"} received without a cost price and {purchases.uncostedUnits === 1 ? "is" : "are"} not in the total.
          </Warning>
        ) : null}
      </Panel>
    </div>
  );
}

/* ---------- Money in hand ---------- */

export function MoneyView({
  balances,
  movement,
  entries,
  sym,
  rangeLabel,
}: {
  balances: Balances | null;
  movement: MoneyMovement;
  entries: { items: MoneyEntry[]; more: boolean };
  sym: string;
  rangeLabel: string;
}) {
  const money = (v: string) => formatMoney(v, sym);
  const lines: { label: string; key: keyof AccountMovement; minus?: boolean }[] = [
    { label: "Received from customers", key: "received" },
    { label: "Shop expenses", key: "expenses", minus: true },
    { label: "Salary paid", key: "salary", minus: true },
    { label: "Advances given", key: "advances", minus: true },
    { label: "Stock bought", key: "stock", minus: true },
  ];
  const accounts = ["cash", "bank", "total"] as const;
  const tone = (v: string) => (toPaise(v) < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-lg">
              <Landmark className="size-4.5 text-primary" /> Money you have now
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {balances
                ? `Counted from ${formatDateTime(balances.openingAt)}, when you set cash ${money(balances.openingCash)} and bank ${money(balances.openingBank)}.`
                : "Type what is in your cash drawer and your bank today. The app keeps both up to date from then on."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {balances && toPaise(balances.cash) > 0 ? <CashToBankForm cash={balances.cash} currencySymbol={sym} /> : null}
            <MoneyBalanceForm cash={balances?.cash ?? null} bank={balances?.bank ?? null} currencySymbol={sym} />
          </div>
        </div>
        {balances ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Banknote className="size-4" /> Cash in drawer
              </p>
              <p className={cn("mt-1 text-3xl font-semibold tabular-nums", toPaise(balances.cash) < 0 && "text-red-700 dark:text-red-300")}>{money(balances.cash)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Landmark className="size-4" /> In bank · UPI and Card
              </p>
              <p className={cn("mt-1 text-3xl font-semibold tabular-nums", toPaise(balances.bank) < 0 && "text-red-700 dark:text-red-300")}>{money(balances.bank)}</p>
            </div>
          </div>
        ) : null}
      </section>

      <Panel title="Money in and out" icon={Wallet} note={rangeLabel}>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-right text-xs text-muted-foreground">
                <th className="py-2 text-left font-normal" />
                <th className="py-2 pl-3 font-normal">Cash</th>
                <th className="py-2 pl-3 font-normal">Bank</th>
                <th className="py-2 pl-3 font-normal">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l) => (
                <tr key={l.key}>
                  <td className="py-2.5">
                    {l.minus ? "− " : ""}
                    {l.label}
                  </td>
                  {accounts.map((a) => (
                    <td key={a} className="py-2.5 pl-3 text-right tabular-nums">
                      {money(movement[a][l.key])}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="py-2.5">Cash moved to bank</td>
                {accounts.map((a) => (
                  <td key={a} className="py-2.5 pl-3 text-right tabular-nums">
                    {money(movement[a].moved)}
                  </td>
                ))}
              </tr>
              <tr className="font-semibold">
                <td className="py-3">= Change</td>
                {accounts.map((a) => (
                  <td key={a} className={cn("py-3 pl-3 text-right tabular-nums", tone(movement[a].change))}>
                    {money(movement[a].change)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Passbook" icon={Banknote} note="Every payment in and out in this period, newest first.">
        {entries.items.length === 0 ? (
          <Empty>No money came in or went out in this period.</Empty>
        ) : (
          <ul className="mt-4 divide-y text-sm">
            {entries.items.map((e) => (
              <li key={e.key} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  {e.href ? (
                    <Link href={e.href} className="block truncate font-medium hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{e.label}</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(e.date)} · {e.method ? PAYMENT_LABEL[e.method] : e.account === "cash" ? "Cash" : "Bank"}
                  </span>
                </span>
                {e.depositId ? <DeleteCashDeposit depositId={e.depositId} amount={money(fromPaise(Math.abs(toPaise(e.amount))))} /> : null}
                <span className={cn("w-28 text-right font-medium tabular-nums", tone(e.amount))}>
                  {toPaise(e.amount) < 0 ? `− ${money(fromPaise(-toPaise(e.amount)))}` : `+ ${money(e.amount)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.more ? <Warning>Only the latest {formatNumber(entries.items.length)} entries are shown. Pick a shorter period to see the rest.</Warning> : null}
        <p className="mt-3 text-xs text-muted-foreground">Stock orders received before this feature was added have no payment method and are not counted.</p>
      </Panel>
    </div>
  );
}

/* ---------- Profit ---------- */

export function ProfitView({ p, sym, spentHref }: { p: ProfitReport; sym: string; spentHref: string }) {
  const money = (v: string) => formatMoney(v, sym);
  const sales = toPaise(p.sales);
  const profit = toPaise(p.profit);
  const costs = [
    { label: "Product cost", short: "products", value: p.productCost, bar: "bg-sky-500" },
    { label: "Shop expenses", short: "expenses", value: p.expenses, bar: "bg-amber-500" },
    { label: "Staff pay", short: "staff", value: p.staffPay, bar: "bg-violet-500" },
  ];
  // Out of every 100 of sales; only meaningful when something was sold and not lost.
  const per100 = (v: string) => Math.round((toPaise(v) / sales) * 100);

  return (
    <div className="space-y-6">
      <Panel title="Where the money went" icon={Banknote}>
        <ul className="mt-4 divide-y text-sm sm:text-base">
          <li className="flex items-center justify-between py-3">
            <span>Sales</span>
            <span className="font-medium tabular-nums">{money(p.sales)}</span>
          </li>
          {costs.map((c) => (
            <li key={c.label}>
              <Link href={spentHref} className="group flex items-center justify-between py-3 hover:text-primary">
                <span className="flex items-center gap-1.5">
                  − {c.label} <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="tabular-nums">{money(c.value)}</span>
              </Link>
            </li>
          ))}
          <li className={cn("flex items-center justify-between py-3 text-lg font-semibold", profit >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")}>
            <span>= {profit >= 0 ? "Profit" : "Loss"}</span>
            <span className="tabular-nums">{money(p.profit)}</span>
          </li>
        </ul>
        {p.report.uncostedUnitsSold > 0 ? (
          <Warning>
            {formatNumber(p.report.uncostedUnitsSold)} {p.report.uncostedUnitsSold === 1 ? "unit was" : "units were"} sold without a cost price, so profit looks higher than it is.
          </Warning>
        ) : null}
        {p.staffWithoutSalary > 0 ? (
          <Warning>
            {formatNumber(p.staffWithoutSalary)} {p.staffWithoutSalary === 1 ? "employee has" : "employees have"} no salary set, so staff pay is too low.
          </Warning>
        ) : null}
      </Panel>

      {sales > 0 && profit >= 0 ? (
        <Panel title={`Out of every ${sym}100 of sales`} icon={HandCoins}>
          <div className="mt-4 flex h-6 overflow-hidden rounded-md bg-emerald-500">
            {costs.map((c) => (
              <span key={c.label} className={c.bar} style={{ width: `${(toPaise(c.value) / sales) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {costs.map((c) => (
              <li key={c.label} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-full", c.bar)} />
                {sym}
                {per100(c.value)} {c.short}
              </li>
            ))}
            <li className="flex items-center gap-1.5 font-medium">
              <span className="size-2.5 rounded-full bg-emerald-500" />
              {sym}
              {100 - costs.reduce((n, c) => n + per100(c.value), 0)} profit
            </li>
          </ul>
        </Panel>
      ) : sales > 0 ? (
        <p className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          The shop spent {money(fromPaise(-profit))} more than it sold in this period.
        </p>
      ) : null}
    </div>
  );
}
