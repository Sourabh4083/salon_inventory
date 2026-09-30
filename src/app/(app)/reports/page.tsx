import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Ban, HandCoins, Package, PiggyBank, Receipt, Scissors, TrendingUp, Truck, Wallet } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getSalesReport } from "@/lib/services/billing";
import { expenseTotal } from "@/lib/services/expenses";
import { getPurchaseReport } from "@/lib/services/orders";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { resolveRange, toDateParam } from "@/lib/dates";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { fromPaise, toPaise } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { ReportRangePicker } from "@/components/app/report-range-picker";
import { PAYMENT_LABEL } from "@/components/app/bill-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requirePermissionPage("report.view");
  const params = await searchParams;
  const range = resolveRange(params);
  const [settings, report, expenses, purchases] = await Promise.all([getSettings(), getSalesReport(range), expenseTotal(range), getPurchaseReport(range)]);
  const sym = settings.currencySymbol;
  const money = (v: string) => formatMoney(v, sym);
  const profitPositive = toPaise(report.grossProfit) >= 0;
  const net = fromPaise(toPaise(report.revenue) - toPaise(expenses));
  const netPositive = toPaise(net) >= 0;
  const maxDay = Math.max(1, ...report.byDay.map((d) => toPaise(d.amount)));
  const sameDay = toDateParam(range.from) === toDateParam(range.to);
  const rangeLabel = sameDay ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;

  const kpis = [
    { label: "Sales", value: money(report.revenue), sub: `${formatNumber(report.billCount)} ${report.billCount === 1 ? "bill" : "bills"}`, icon: Receipt, tone: "text-primary bg-primary/10" },
    { label: "Products", value: money(report.productRevenue), sub: `${formatNumber(report.unitsSold)} units sold`, icon: Package, tone: "text-sky-700 bg-sky-100" },
    { label: "Services", value: money(report.serviceRevenue), sub: "service income", icon: Scissors, tone: "text-violet-700 bg-violet-100" },
    {
      label: "Gross profit",
      value: money(report.grossProfit),
      sub: `after ${money(report.cost)} product cost`,
      icon: TrendingUp,
      tone: profitPositive ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100",
    },
    { label: "Expenses", value: money(expenses), sub: "shop spending", icon: Wallet, tone: "text-amber-700 bg-amber-100" },
    {
      label: "Product purchases",
      value: money(purchases.total),
      sub: `${formatNumber(purchases.units)} ${purchases.units === 1 ? "unit" : "units"} received`,
      icon: Truck,
      tone: "text-orange-700 bg-orange-100",
    },
    {
      label: "Sales − expenses",
      value: money(net),
      sub: "money left after spending",
      icon: PiggyBank,
      tone: netPositive ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Reports"
        description={`Completed bills for ${rangeLabel}. Cancelled bills are excluded.`}
        actions={<DownloadExcelButton kind="sales-report" />}
      />
      <ReportRangePicker active={range.key} from={toDateParam(range.from)} to={toDateParam(range.to)} />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {kpis.map((k, i) => (
          // The last figure takes the leftover row so the grid stays even.
          <div key={k.label} className={cn("rounded-2xl border bg-card p-4 shadow-xs sm:p-5", i === kpis.length - 1 && "col-span-2 lg:col-span-3")}>
            <span className={cn("flex size-9 items-center justify-center rounded-xl", k.tone)}>
              <k.icon className="size-4.5" />
            </span>
            <p className="mt-3 text-2xl font-semibold tabular-nums sm:text-3xl">{k.value}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {k.label} · {k.sub}
            </p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border bg-card p-5 shadow-xs xl:col-span-2">
          <h2 className="font-heading text-lg">Sales by day</h2>
          {report.byDay.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">No completed bills in this period.</p>
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

        <section className="rounded-2xl border bg-card p-5 shadow-xs">
          <h2 className="flex items-center gap-2 font-heading text-lg">
            <Banknote className="size-4.5 text-primary" /> Payments received
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">Money that came in during this period, including dues collected on older bills.</p>
          <ul className="mt-4 divide-y text-sm">
            {report.byPayment.map((p) => (
              <li key={p.method} className="flex items-center justify-between py-2.5">
                <span>
                  {PAYMENT_LABEL[p.method]}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.count} {p.count === 1 ? "payment" : "payments"}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{money(p.amount)}</span>
              </li>
            ))}
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
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TopList title="Top products" icon={Package} rows={report.topProducts.map((p) => ({ key: p.productId ?? p.name, name: p.name, quantity: p.quantity, amount: money(p.amount), href: p.productId ? `/inventory/${p.productId}` : undefined }))} empty="No products sold in this period." />
        <TopList title="Top services" icon={Scissors} rows={report.topServices.map((s) => ({ key: s.name, name: s.name, quantity: s.quantity, amount: money(s.amount) }))} empty="No services billed in this period." />
      </div>

      <section className="rounded-2xl border bg-card p-5 shadow-xs">
        <h2 className="flex items-center gap-2 font-heading text-lg">
          <Truck className="size-4.5 text-primary" /> Products received from orders
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Counted on the day the goods arrived, at the order&apos;s cost price.</p>
        {purchases.orders.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">No order deliveries in this period.</p>
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
            <li className="flex items-center justify-between py-2.5 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(purchases.total)}</span>
            </li>
          </ul>
        )}
        {purchases.uncostedUnits > 0 ? (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            {formatNumber(purchases.uncostedUnits)} {purchases.uncostedUnits === 1 ? "unit was" : "units were"} received without a cost price and {purchases.uncostedUnits === 1 ? "is" : "are"} not in the total.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function TopList({
  title,
  icon: Icon,
  rows,
  empty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: { key: string; name: string; quantity: number; amount: string; href?: string }[];
  empty: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <Icon className="size-4.5 text-primary" /> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{empty}</p>
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
    </section>
  );
}
