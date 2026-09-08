import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Ban, Package, Receipt, Scissors, TrendingUp } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getSalesReport } from "@/lib/services/billing";
import { resolveRange, toDateParam } from "@/lib/dates";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { toPaise } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { ReportRangePicker } from "@/components/app/report-range-picker";
import { PAYMENT_LABEL } from "@/components/app/bill-badges";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requirePermissionPage("report.view");
  const params = await searchParams;
  const range = resolveRange(params);
  const [settings, report] = await Promise.all([getSettings(), getSalesReport(range)]);
  const sym = settings.currencySymbol;
  const money = (v: string) => formatMoney(v, sym);
  const profitPositive = toPaise(report.grossProfit) >= 0;
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Reports" description={`Completed bills for ${rangeLabel}. Cancelled bills are excluded.`} />
      <ReportRangePicker active={range.key} from={toDateParam(range.from)} to={toDateParam(range.to)} />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
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
            <Banknote className="size-4.5 text-primary" /> Payments
          </h2>
          <ul className="mt-4 divide-y text-sm">
            {report.byPayment.map((p) => (
              <li key={p.method} className="flex items-center justify-between py-2.5">
                <span>
                  {PAYMENT_LABEL[p.method]}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.count} {p.count === 1 ? "bill" : "bills"}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{money(p.amount)}</span>
              </li>
            ))}
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
