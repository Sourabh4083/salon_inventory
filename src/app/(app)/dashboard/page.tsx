import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Boxes, Package, PackageX, Receipt, TrendingUp, Truck } from "lucide-react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getDashboardStats, listMovements } from "@/lib/services/inventory";
import { listProducts, productsForViewer } from "@/lib/services/products";
import { getSalesReport } from "@/lib/services/billing";
import { countActiveOrders } from "@/lib/services/orders";
import { resolveRange } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/format";
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
  const [{ denied }, settings, stats, low, out, recent, today, activeOrders] = await Promise.all([
    searchParams,
    getSettings(),
    getDashboardStats(),
    listProducts({ stockStatus: "LOW_STOCK", sort: "quantity", pageSize: 6 }),
    listProducts({ stockStatus: "OUT_OF_STOCK", sort: "updated", pageSize: 6 }),
    showActivity ? listMovements({ pageSize: 8 }) : null,
    showSales ? getSalesReport(resolveRange({ range: "today" })) : null,
    can(user.role, "order.view") ? countActiveOrders() : 0,
  ]);

  const kpis = [
    { label: "Total Products", value: stats.totalProducts, icon: Package, href: "/inventory", tone: "text-primary bg-primary/10" },
    { label: "Units in Stock", value: stats.totalUnits, icon: Boxes, href: "/inventory", tone: "text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-500/15" },
    { label: "Low Stock", value: stats.lowStockCount, icon: AlertTriangle, href: "/inventory/low-stock", tone: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15" },
    { label: "Out of Stock", value: stats.outOfStockCount, icon: PackageX, href: "/inventory/out-of-stock", tone: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-500/15" },
  ];

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

      {today ? (
        <section aria-label="Sales today" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href="/reports?range=today" className="group flex items-center gap-4 rounded-2xl border bg-primary p-4 text-primary-foreground shadow-xs dark:border-primary/30 dark:bg-primary/15 dark:text-foreground transition-shadow hover:shadow-md sm:col-span-2 sm:p-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 dark:bg-primary/20 dark:text-primary">
              <Receipt className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm opacity-80">Sales today</span>
              <span className="block text-3xl font-semibold tabular-nums sm:text-4xl">{formatMoney(today.revenue, settings.currencySymbol)}</span>
              <span className="block text-xs opacity-80">
                {today.billCount} {today.billCount === 1 ? "bill" : "bills"} · products {formatMoney(today.productRevenue, settings.currencySymbol)} · services {formatMoney(today.serviceRevenue, settings.currencySymbol)}
              </span>
            </span>
            <ArrowRight className="size-5 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <Link href="/reports?range=today" className="group rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              <TrendingUp className="size-4.5" />
            </span>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{formatMoney(today.grossProfit, settings.currencySymbol)}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Gross profit today</p>
          </Link>
        </section>
      ) : null}

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="group rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between">
              <span className={cn("flex size-9 items-center justify-center rounded-xl", k.tone)}>
                <k.icon className="size-4.5" />
              </span>
              <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums sm:text-4xl">{formatNumber(k.value)}</p>
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
