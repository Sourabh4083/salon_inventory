import Link from "next/link";
import { ArrowDownToLine, ClipboardCheck, PackageMinus, PackagePlus, PencilLine, ShoppingBag, Undo2 } from "lucide-react";
import type { MovementDTO } from "@/lib/services/products";
import type { MovementType } from "@/generated/prisma/enums";
import { movementLabel } from "@/lib/constants";
import { formatDateTime, formatRelative, signedQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A SALE with no bill is a manual reduction, so it gets its own icon and wording. */
type IconKey = MovementType | "MANUAL_REDUCTION";

function iconKey(type: MovementType, billId: string | null): IconKey {
  return type === "SALE" && billId === null ? "MANUAL_REDUCTION" : type;
}

const ICON: Record<IconKey, React.ComponentType<{ className?: string }>> = {
  INITIAL_STOCK: PackagePlus,
  STOCK_IN: ArrowDownToLine,
  SALE: ShoppingBag,
  MANUAL_REDUCTION: PackageMinus,
  ADJUSTMENT: ClipboardCheck,
  BILL_CANCELLED: Undo2,
  BILL_EDITED: PencilLine,
};

const TONE: Record<MovementType, string> = {
  INITIAL_STOCK: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  STOCK_IN: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  SALE: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  ADJUSTMENT: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  BILL_CANCELLED: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  BILL_EDITED: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
};

export function MovementTypeChip({ type, billId }: { type: MovementType; billId: string | null }) {
  const Icon = ICON[iconKey(type, billId)];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase", TONE[type])}>
      <Icon className="size-3" /> {movementLabel(type, billId)}
    </span>
  );
}

export function QuantityChange({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        value > 0 ? "text-emerald-700 dark:text-emerald-300" : value < 0 ? "text-red-700 dark:text-red-300" : "text-muted-foreground",
        className,
      )}
    >
      {signedQuantity(value)}
    </span>
  );
}

/**
 * Responsive movement list: stacked rows on mobile, table-like grid on larger screens.
 * `showProduct` links each row to its product (global activity page).
 */
export function MovementList({
  movements,
  showProduct = true,
  compact = false,
}: {
  movements: MovementDTO[];
  showProduct?: boolean;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y rounded-2xl border bg-card shadow-xs">
      {movements.map((m) => (
        <li key={m.id} className="flex items-start gap-3 px-4 py-3">
          <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", TONE[m.type])}>
            {(() => {
              const Icon = ICON[iconKey(m.type, m.billId)];
              return <Icon className="size-4" />;
            })()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {showProduct ? (
                  <Link href={`/inventory/${m.productId}`} className="block truncate font-medium hover:text-primary">
                    {m.productName}
                  </Link>
                ) : (
                  <p className="font-medium">{movementLabel(m.type, m.billId)}</p>
                )}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {showProduct ? <MovementTypeChip type={m.type} billId={m.billId} /> : null}
                  <span>{m.performedByName}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                    {compact ? formatRelative(m.createdAt) : formatDateTime(m.createdAt)}
                  </time>
                </p>
                {m.purchaseOrderId && m.orderNumber ? (
                  <Link href={`/orders/${m.purchaseOrderId}`} className="mt-1 inline-block text-xs font-medium text-primary hover:underline">
                    From order {m.orderNumber}
                  </Link>
                ) : m.note && !compact ? (
                  <p className="mt-1 text-xs text-muted-foreground italic">“{m.note}”</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <QuantityChange value={m.quantityChange} className="text-base" />
                <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {m.previousQuantity} → {m.newQuantity}
                </p>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
