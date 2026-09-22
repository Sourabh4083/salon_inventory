import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getOrder, orderForViewer } from "@/lib/services/orders";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { OrderStatusBadge } from "@/components/app/order-badges";
import { OrderActions } from "@/components/app/order-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage("order.view");
  const { id } = await params;
  const [settings, found] = await Promise.all([getSettings(), getOrder(id)]);
  if (!found) notFound();
  const order = orderForViewer(found, user.role);
  const sym = settings.currencySymbol;
  const showCost = user.role === "OWNER";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground" render={<Link href="/orders" />}>
          <ArrowLeft /> All orders
        </Button>
        <PageHeader
          title={order.orderNumber}
          description={
            <span className="flex flex-wrap items-center gap-2">
              Ordered {formatDateTime(order.createdAt)} by {order.createdByName}
              <OrderStatusBadge status={order.status} partly={order.totalReceived > 0} />
            </span>
          }
        />
        {order.notes ? <p className="-mt-2 mb-4 text-sm text-muted-foreground italic">“{order.notes}”</p> : null}
        {order.status === "CLOSED" ? (
          <p role="status" className="mb-4 rounded-xl border bg-muted/50 px-4 py-3 text-sm">
            Closed {order.closedAt ? formatDateTime(order.closedAt) : ""} by {order.closedByName ?? "owner"}: {order.closeReason}.
            {order.totalPending > 0 ? ` ${order.totalPending} ${order.totalPending === 1 ? "unit was" : "units were"} never received.` : ""}
          </p>
        ) : null}
        {order.status === "RECEIVED" ? (
          <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Everything on this order has been received and added to stock.
          </p>
        ) : null}
        <OrderActions order={order} role={user.role} />
      </div>

      <section className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-3 py-3 text-right font-medium">Ordered</th>
              <th className="px-3 py-3 text-right font-medium">Received</th>
              <th className="px-3 py-3 text-right font-medium">{order.status === "CLOSED" ? "Not received" : "Pending"}</th>
              {showCost ? <th className="px-4 py-3 text-right font-medium">Cost</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3">
                  {i.productId ? (
                    <Link href={`/inventory/${i.productId}`} className="font-medium hover:text-primary">
                      {i.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground line-through" title="Product deleted from inventory">
                      {i.name}
                    </span>
                  )}
                  {i.inStock !== null ? <span className="block text-xs text-muted-foreground">{i.inStock} in stock now</span> : null}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{i.quantityOrdered}</td>
                <td className="px-3 py-3 text-right tabular-nums">{i.quantityReceived}</td>
                <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", i.pending > 0 && order.status === "ACTIVE" && "text-amber-700 dark:text-amber-300")}>
                  {i.pending}
                </td>
                {showCost ? (
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {i.unitCost ? `${formatMoney(i.unitCost, sym)} × ${i.quantityOrdered}` : "—"}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              <td className="px-4 py-3">Total</td>
              <td className="px-3 py-3 text-right tabular-nums">{order.totalOrdered}</td>
              <td className="px-3 py-3 text-right tabular-nums">{order.totalReceived}</td>
              <td className="px-3 py-3 text-right tabular-nums">{order.totalPending}</td>
              {showCost ? <td className="px-4 py-3 text-right tabular-nums">{order.totalCost ? formatMoney(order.totalCost, sym) : "—"}</td> : null}
            </tr>
          </tfoot>
        </table>
      </section>

      <section className="space-y-3" aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="flex items-center gap-2 font-heading text-lg">
          <History className="size-4.5 text-primary" /> Deliveries
        </h2>
        {order.receipts.length ? (
          <ul className="divide-y rounded-2xl border bg-card shadow-xs">
            {order.receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    Received by {r.performedByName} · {formatDateTime(r.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">+{r.quantity}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Nothing has been received yet.</p>
        )}
      </section>
    </div>
  );
}
