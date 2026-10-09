import { Banknote, CreditCard, Smartphone } from "lucide-react";
import type { BillStatus, PaymentMethod } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/format";
import { fromPaise, toPaise } from "@/lib/money";
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

/** What the bills list shows for payment: the amount still owed, or how it was paid. */
export function BillPaymentStatus({
  bill,
  currencySymbol,
}: {
  bill: { status: BillStatus; balanceDue: string; paymentMethod: PaymentMethod | null; payments: { method: PaymentMethod }[] };
  currencySymbol: string;
}) {
  if (bill.status === "COMPLETED" && Number(bill.balanceDue) > 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-orange-800 uppercase dark:bg-orange-500/10 dark:text-orange-300">
        Due {formatMoney(bill.balanceDue, currencySymbol)}
      </span>
    );
  }
  // A split bill (half cash, half UPI) shows every method it was paid by.
  const methods = [...new Set(bill.payments.map((p) => p.method))];
  if (methods.length > 1) {
    return (
      <span className="inline-flex flex-wrap justify-end gap-1">
        {methods.map((m) => (
          <PaymentChip key={m} method={m} />
        ))}
      </span>
    );
  }
  const method = bill.paymentMethod ?? methods[0];
  return method ? <PaymentChip method={method} /> : null;
}

/** What was received by each method, in Cash, UPI, Card order, for a bill's payments. */
export function amountsByMethod(payments: { method: PaymentMethod; amount: string }[]) {
  return (Object.keys(PAYMENT_LABEL) as PaymentMethod[])
    .map((method) => ({ method, amount: fromPaise(payments.filter((p) => p.method === method).reduce((n, p) => n + toPaise(p.amount), 0)) }))
    .filter((p) => toPaise(p.amount) > 0);
}

/** "Cash + UPI" for the methods used across a bill's payments. */
export function paymentMethodsLabel(payments: { method: PaymentMethod }[]) {
  return [...new Set(payments.map((p) => p.method))].map((m) => PAYMENT_LABEL[m]).join(" + ");
}
