import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { History, Plus, Truck } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { countActiveOrders, listOrders, orderForViewer } from "@/lib/services/orders";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { OrderCard } from "@/components/app/order-card";
import { OrderSearch } from "@/components/app/order-search";
import { Pagination } from "@/components/app/pagination";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const user = await requirePermissionPage("order.view");
  const params = await searchParams;
  const history = params.view === "history";
  const canOrder = can(user.role, "order.manage");
  const [settings, activeCount, result] = await Promise.all([
    getSettings(),
    countActiveOrders(),
    listOrders({
      statuses: history ? ["RECEIVED", "CLOSED"] : ["ACTIVE"],
      search: params.q,
      page: Number(params.page) || 1,
      pageSize: history ? 20 : 50,
    }),
  ]);

  const newOrderButton = canOrder ? (
    <Button size="lg" className="h-11" render={<Link href="/orders/new" />}>
      <Plus /> New order
    </Button>
  ) : null;

  const tab = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
      active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Products you have ordered for the shop. When a delivery arrives, click Received and the stock updates."
        actions={newOrderButton}
      />

      <nav aria-label="Order views" className="inline-flex rounded-xl bg-muted p-1">
        <Link href="/orders" className={tab(!history)} aria-current={!history ? "page" : undefined}>
          <Truck className="size-4" /> Waiting
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">{activeCount}</span>
        </Link>
        <Link href="/orders?view=history" className={tab(history)} aria-current={history ? "page" : undefined}>
          <History className="size-4" /> History
        </Link>
      </nav>

      {history ? (
        <Suspense>
          <OrderSearch />
        </Suspense>
      ) : null}

      {result.items.length === 0 ? (
        history ? (
          <EmptyState icon={History} title={params.q ? "No orders match this search" : "No finished orders yet"} description="Orders appear here once they are fully received or closed." />
        ) : (
          <EmptyState
            icon={Truck}
            title="Nothing on order"
            description={canOrder ? "Create an order with the products you need. It waits here until they arrive." : "The owner hasn't placed any orders that are waiting for delivery."}
            action={newOrderButton}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {result.items.map((o) => (
              <OrderCard key={o.id} order={orderForViewer(o, user.role)} role={user.role} currencySymbol={settings.currencySymbol} />
            ))}
          </div>
          <Suspense>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
          </Suspense>
        </>
      )}
    </div>
  );
}
