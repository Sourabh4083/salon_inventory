import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, PiggyBank, Receipt, Wallet } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getProfitReport } from "@/lib/services/profit";
import { getBalances, getMoneyMovement, listMoneyEntries } from "@/lib/services/cashbook";
import { listExpenses } from "@/lib/services/expenses";
import { getPurchaseReport } from "@/lib/services/orders";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { resolveRange, toDateParam } from "@/lib/dates";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { toPaise } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { ReportRangePicker } from "@/components/app/report-range-picker";
import { MoneyView, ProfitView, SalesView, SpentView } from "@/components/app/report-views";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales Reports" };

const VIEWS = ["sales", "spent", "profit", "cash"] as const;
type View = (typeof VIEWS)[number];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; view?: string }> }) {
  const user = await requirePermissionPage("report.view");
  const params = await searchParams;
  const range = resolveRange(params);
  const view: View = VIEWS.includes(params.view as View) ? (params.view as View) : "sales";
  const [settings, p, balances, spentDetails, cashDetails] = await Promise.all([
    getSettings(),
    getProfitReport(range),
    getBalances(),
    view === "spent" ? Promise.all([listExpenses({ from: range.from, to: range.to, pageSize: 100 }, user), getPurchaseReport(range)]) : null,
    view === "cash" ? Promise.all([getMoneyMovement(range), listMoneyEntries(range)]) : null,
  ]);
  const sym = settings.currencySymbol;
  const money = (v: string) => formatMoney(v, sym);
  const profitPositive = toPaise(p.profit) >= 0;
  const sameDay = toDateParam(range.from) === toDateParam(range.to);
  const rangeLabel = sameDay ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
  const rangeQuery = range.key === "custom" ? `range=custom&from=${toDateParam(range.from)}&to=${toDateParam(range.to)}` : `range=${range.key}`;
  const hrefFor = (v: View) => `/reports?${rangeQuery}&view=${v}`;

  const cards = [
    { view: "sales" as const, label: "Sales", value: money(p.sales), sub: `${formatNumber(p.report.billCount)} ${p.report.billCount === 1 ? "bill" : "bills"}`, icon: Receipt, tone: "text-primary bg-primary/10" },
    { view: "spent" as const, label: "Money spent", value: money(p.spent), sub: "products, expenses, staff", icon: Wallet, tone: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15" },
    {
      view: "profit" as const,
      label: profitPositive ? "Profit" : "Loss",
      value: money(p.profit),
      sub: "sales − money spent",
      icon: PiggyBank,
      tone: profitPositive ? "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15" : "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-500/15",
    },
    {
      view: "cash" as const,
      label: "Money in hand",
      value: balances ? money(balances.total) : "Set balance",
      sub: balances ? `cash ${money(balances.cash)} · bank ${money(balances.bank)}` : "cash and bank",
      icon: Landmark,
      tone: "text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-500/15",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Reports"
        description={`Completed bills for ${rangeLabel}. Cancelled bills are excluded.`}
        actions={<DownloadExcelButton kind="sales-report" />}
      />
      <ReportRangePicker active={range.key} from={toDateParam(range.from)} to={toDateParam(range.to)} view={view} />

      <nav aria-label="Report" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((k) => (
          <Link
            key={k.view}
            href={hrefFor(k.view)}
            scroll={false}
            aria-current={view === k.view ? "page" : undefined}
            className={cn("rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5", view === k.view && "border-primary ring-2 ring-primary/30")}
          >
            <span className={cn("flex size-9 items-center justify-center rounded-xl", k.tone)}>
              <k.icon className="size-4.5" />
            </span>
            <p className="mt-3 text-2xl font-semibold tabular-nums sm:text-3xl">{k.value}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {k.label} · {k.sub}
            </p>
          </Link>
        ))}
      </nav>

      {view === "sales" ? <SalesView p={p} sym={sym} billsHref={range.key === "custom" ? "/billing" : `/billing?range=${range.key}`} /> : null}
      {spentDetails ? <SpentView p={p} sym={sym} expenses={spentDetails[0]} purchases={spentDetails[1]} expensesHref={`/expenses?${rangeQuery}`} /> : null}
      {view === "profit" ? <ProfitView p={p} sym={sym} spentHref={hrefFor("spent")} /> : null}
      {cashDetails ? <MoneyView balances={balances} movement={cashDetails[0]} entries={cashDetails[1]} sym={sym} rangeLabel={rangeLabel} /> : null}
    </div>
  );
}
