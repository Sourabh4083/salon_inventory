import Link from "next/link";
import type { OrderDTO } from "@/lib/services/orders";
import type { Role } from "@/generated/prisma/enums";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/app/order-badges";
import { OrderActions } from "@/components/app/order-actions";

/** One order on the Orders page: what was ordered, what came, what's still pending. */
export function OrderCard({ order, role, currencySymbol }: { order: OrderDTO; role: Role; currencySymbol: string }) {
  return (
    <article className="rounded-2xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <Link href={`/orders/${order.id}`} className="flex items-center gap-2 font-heading text-lg hover:text-primary">
            {order.orderNumber}
            <OrderStatusBadge status={order.status} partly={order.totalReceived > 0} />
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ordered <time dateTime={order.createdAt} title={formatDate(order.createdAt)}>{formatRelative(order.createdAt)}</time> by {order.createdByName}
            {order.totalCost ? ` · ${formatMoney(order.totalCost, currencySymbol)}` : ""}
          </p>
          {order.notes ? <p className="mt-1 text-sm text-muted-foreground italic">“{order.notes}”</p> : null}
        </div>
        <p className="text-right text-sm">
          <span className="text-2xl font-semibold tabular-nums">{order.totalPending}</span>
          <span className="block text-xs text-muted-foreground">{order.status === "CLOSED" ? "not received" : "units pending"}</span>
        </p>
      </header>

      <ul className="divide-y">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <div className="min-w-0 flex-1">
              {i.productId ? (
                <Link href={`/inventory/${i.productId}`} className="block truncate font-medium hover:text-primary">
                  {i.name}
                </Link>
              ) : (
                <p className="truncate font-medium text-muted-foreground line-through" title="Product deleted from inventory">
                  {i.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                ordered {i.quantityOrdered}
                {i.quantityReceived > 0 ? ` · received ${i.quantityReceived}` : ""}
                {i.unitCost ? ` · ${formatMoney(i.unitCost, currencySymbol)} each` : ""}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                i.pending === 0
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : order.status === "CLOSED"
                    ? "bg-muted text-muted-foreground"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
              )}
            >
              {i.pending === 0 ? "✓ all received" : order.status === "CLOSED" ? `${i.pending} not received` : `${i.pending} pending`}
            </span>
          </li>
        ))}
      </ul>

      {order.status === "ACTIVE" ? <OrderActions order={order} role={role} className="border-t px-4 py-3 sm:px-5" /> : null}
    </article>
  );
}
