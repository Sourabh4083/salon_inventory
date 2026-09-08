import { Banknote, CreditCard, Smartphone } from "lucide-react";
import type { BillStatus, PaymentMethod } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" };

const PAYMENT_ICON: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
};

export function PaymentChip({ method, className }: { method: PaymentMethod; className?: string }) {
  const Icon = PAYMENT_ICON[method];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase", className)}>
      <Icon className="size-3" /> {PAYMENT_LABEL[method]}
    </span>
  );
}

export function BillStatusBadge({ status }: { status: BillStatus }) {
  if (status === "COMPLETED") return null;
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-red-700 uppercase dark:bg-red-500/10 dark:text-red-300">
      Cancelled
    </span>
  );
}
