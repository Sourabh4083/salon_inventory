import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Banknote, Boxes, HandCoins, Landmark, Package, PackageX, PiggyBank, Receipt, Truck, Wallet } from "lucide-react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getDashboardStats, listMovements } from "@/lib/services/inventory";
import { listProducts, productsForViewer } from "@/lib/services/products";
import { getOutstanding } from "@/lib/services/billing";
import { getProfitReport } from "@/lib/services/profit";
import { getBalances } from "@/lib/services/cashbook";
import { countActiveOrders } from "@/lib/services/orders";
import { resolveRange } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/format";
import { toPaise } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { QuickActions } from "@/components/app/quick-actions";
import { MovementList } from "@/components/app/movement-list";
import { DashboardStockList } from "@/components/app/dashboard-stock-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUserPage();
  const showSales = can(user.role, "report.view");
  const showActivity = can(user.role, "stock.history.view");
  const [{ denied }, settings, stats, low, out, recent, money, activeOrders] = await Promise.all([
    searchParams,
    getSettings(),
    getDashboardStats(),
    listProducts({ stockStatus: "LOW_STOCK", sort: "quantity", pageSize: 6 }),
    listProducts({ stockStatus: "OUT_OF_STOCK", sort: "updated", pageSize: 6 }),
    showActivity ? listMovements({ pageSize: 8 }) : null,
    showSales ? Promise.all([getProfitReport(resolveRange({ range: "today" })), getProfitReport(resolveRange({ range: "month" })), getOutstanding(), getBalances()]) : null,
    can(user.role, "order.view") ? countActiveOrders() : 0,
  ]);
  const sym = settings.currencySymbol;

  const stockKpis = [
    { label: "Low Stock", value: formatNumber(stats.lowStockCount), icon: AlertTriangle, href: "/inventory/low-stock", tone: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15" },
    { label: "Out of Stock", value: formatNumber(stats.outOfStockCount), icon: PackageX, href: "/inventory/out-of-stock", tone: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-500/15" },
  ];
  // The owner's tiles are about money; the manager sees no money, only stock counts.
  const kpis = money
    ? [
        { label: "Cash in drawer", value: money[3] ? formatMoney(money[3].cash, sym) : "Set balance", icon: Banknote, href: "/reports?range=today&view=cash", tone: "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15" },
        { label: "In bank · UPI and Card", value: money[3] ? formatMoney(money[3].bank, sym) : "Set balance", icon: Landmark, href: "/reports?range=today&view=cash", tone: "text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-500/15" },
        { label: `Still to collect · ${money[2].count} ${money[2].count === 1 ? "bill" : "bills"}`, value: formatMoney(money[2].amount, sym), icon: HandCoins, href: "/billing?status=UNPAID", tone: "text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-500/15" },
        { label: "Stock value", value: formatMoney(stats.stockValue, sym), icon: Boxes, href: "/pricing", tone: "text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-500/15" },
        ...stockKpis,
      ]
    : [
        { label: "Total Products", value: formatNumber(stats.totalProducts), icon: Package, href: "/inventory", tone: "text-primary bg-primary/10" },
        { label: "Units in Stock", value: formatNumber(stats.totalUnits), icon: Boxes, href: "/inventory", tone: "text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-500/15" },
        ...stockKpis,
      ];
  const periods = money
    ? [
        { key: "today", title: "Today", p: money[0] },
        { key: "month", title: "This month", p: money[1] },
      ]
    : [];

  return (
    <div className="space-y-6 lg:space-y-8">
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        description={`Here is what is happening at ${settings.businessName} today.`}
      />

      {denied ? (
        <p role="alert" className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          That page is only available to the owner account.
        </p>
      ) : null}

      {activeOrders > 0 ? (
        <Link href="/orders" className="group flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900 transition-shadow hover:shadow-md dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <Truck className="size-5 shrink-0" />
          <span className="flex-1 text-sm">
            <span className="font-semibold">
              {activeOrders} {activeOrders === 1 ? "order is" : "orders are"} waiting for delivery.
            </span>{" "}
            Click Received there when products arrive.
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      ) : null}

      <section aria-label="Quick actions">
        <QuickActions currencySymbol={settings.currencySymbol} />
      </section>

      {periods.map(({ key, title, p }) => {
        const profitPositive = toPaise(p.profit) >= 0;
        const cards = [
          { view: "sales", label: "Sales", value: p.sales, sub: `${formatNumber(p.report.billCount)} ${p.report.billCount === 1 ? "bill" : "bills"}`, icon: Receipt, tone: "text-primary bg-primary/10" },
          { view: "spent", label: "Money spent", value: p.spent, sub: "products, expenses, staff", icon: Wallet, tone: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15" },
          {
            view: "profit",
            label: profitPositive ? "Profit" : "Loss",
            value: p.profit,
            sub: "sales − money spent",
            icon: PiggyBank,
            tone: profitPositive ? "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/15" : "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-500/15",
          },
        ];
        return (
          <section key={key} aria-labelledby={`money-${key}`} className="space-y-3">
            <h2 id={`money-${key}`} className="font-heading text-lg">
              {title}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {cards.map((c) => (
                <Link key={c.view} href={`/reports?range=${key}&view=${c.view}`} className="group rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className={cn("flex size-9 items-center justify-center rounded-xl", c.tone)}>
                      <c.icon className="size-4.5" />
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-3 text-2xl font-semibold tabular-nums sm:text-3xl">{formatMoney(c.value, sym)}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {c.label} · {c.sub}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <section aria-label="Key figures" className={cn("grid grid-cols-2 gap-3", money ? "lg:grid-cols-3" : "lg:grid-cols-4")}>
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="group rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between">
              <span className={cn("flex size-9 items-center justify-center rounded-xl", k.tone)}>
                <k.icon className="size-4.5" />
              </span>
              <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className={cn("mt-3 font-semibold tabular-nums", money ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl")}>{k.value}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{k.label}</p>
          </Link>
        ))}
      </section>

      <div className={showActivity ? "grid grid-cols-1 gap-6 xl:grid-cols-3" : "grid grid-cols-1 gap-6 xl:grid-cols-2"}>
        <section className="space-y-3" aria-labelledby="low-heading">
          <div className="flex items-center justify-between">
            <h2 id="low-heading" className="flex items-center gap-2 font-heading text-lg">
              <AlertTriangle className="size-4.5 text-amber-600 dark:text-amber-400" /> Low stock
            </h2>
            <Button variant="ghost" size="sm" render={<Link href="/inventory/low-stock" />}>
              View all <ArrowRight />
            </Button>
          </div>
          <DashboardStockList products={productsForViewer(low.items, user.role)} total={low.total} emptyText="Nothing is running low. Nice." kind="low" />
        </section>

        <section className="space-y-3" aria-labelledby="out-heading">
          <div className="flex items-center justify-between">
            <h2 id="out-heading" className="flex items-center gap-2 font-heading text-lg">
              <PackageX className="size-4.5 text-red-600 dark:text-red-400" /> Out of stock
            </h2>
            <Button variant="ghost" size="sm" render={<Link href="/inventory/out-of-stock" />}>
              View all <ArrowRight />
            </Button>
          </div>
          <DashboardStockList products={productsForViewer(out.items, user.role)} total={out.total} emptyText="Everything is in stock." kind="out" />
        </section>

        {recent ? (
        <section className="space-y-3" aria-labelledby="activity-heading">
          <div className="flex items-center justify-between">
            <h2 id="activity-heading" className="flex items-center gap-2 font-heading text-lg">
              <Activity className="size-4.5 text-primary" /> Recent stock activity
            </h2>
            <Button variant="ghost" size="sm" render={<Link href="/activity" />}>
              View all <ArrowRight />
            </Button>
          </div>
          {recent.items.length ? (
            <MovementList movements={recent.items} compact />
          ) : (
            <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No stock activity yet.</p>
          )}
        </section>
        ) : null}
      </div>
    </div>
  );
}
