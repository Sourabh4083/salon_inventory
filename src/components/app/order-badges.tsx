import type { OrderStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  ACTIVE: "Waiting",
  RECEIVED: "Received",
  CLOSED: "Closed",
};

const TONE: Record<OrderStatus, string> = {
  ACTIVE: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  RECEIVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  CLOSED: "bg-muted text-muted-foreground",
};

export function OrderStatusBadge({ status, partly, className }: { status: OrderStatus; partly?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase", TONE[status], className)}>
      {status === "ACTIVE" && partly ? "Partly received" : ORDER_STATUS_LABEL[status]}
    </span>
  );
}
