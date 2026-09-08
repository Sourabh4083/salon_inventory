import { cn } from "@/lib/utils";
import { STOCK_STATUS_LABEL, type StockStatus } from "@/lib/stock-status";

const STYLES: Record<StockStatus, string> = {
  IN_STOCK: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  LOW_STOCK: "bg-amber-50 text-amber-700 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300",
  OUT_OF_STOCK: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
};

const DOT: Record<StockStatus, string> = {
  IN_STOCK: "bg-emerald-500",
  LOW_STOCK: "bg-amber-500",
  OUT_OF_STOCK: "bg-red-500",
};

export function StockBadge({ status, className, size = "sm" }: { status: StockStatus; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold tracking-wide whitespace-nowrap uppercase ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        STYLES[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {STOCK_STATUS_LABEL[status]}
    </span>
  );
}
