import type { BillDTO } from "@/lib/services/billing";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_LABEL, amountsByMethod, paymentMethodsLabel } from "@/components/app/bill-badges";
import { cn } from "@/lib/utils";

/**
 * Receipt layout used on screen and for printing. On print, everything else on the
 * page is hidden and this is centred: slip width on a thermal roll, larger on A4 (see globals.css).
 */
export function BillReceipt({ bill, businessName, currencySymbol, className }: { bill: BillDTO; businessName: string; currencySymbol: string; className?: string }) {
  const sym = currencySymbol;
  const due = bill.status === "COMPLETED" && Number(bill.balanceDue) > 0;
  const byMethod = amountsByMethod(bill.payments);
  return (
    <article className={cn("receipt mx-auto w-full max-w-sm rounded-2xl border bg-card p-5 text-sm shadow-xs print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none", className)} aria-label={`Receipt ${bill.billNumber}`}>
      <header className="receipt-rule border-b-2 pb-3 text-center">
        <h2 className="font-heading text-xl font-semibold">{businessName}</h2>
        <p className="mt-1 text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">Bill / Receipt</p>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Bill no.</dt>
        <dd className="text-right font-medium">{bill.billNumber}</dd>
        <dt className="text-muted-foreground">Date</dt>
        <dd className="text-right">{formatDateTime(bill.createdAt)}</dd>
        {bill.customerName || bill.customerPhone ? (
          <>
            <dt className="text-muted-foreground">Customer</dt>
            <dd className="text-right">
              {bill.customerName ?? ""}
              {bill.customerPhone ? <span className="block">{bill.customerPhone}</span> : null}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Billed by</dt>
        <dd className="text-right">{bill.createdByName}</dd>
      </dl>

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="receipt-rule border-y text-muted-foreground">
            <th className="py-2 text-left font-medium">Item</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 pl-2 text-right font-medium">Rate</th>
            <th className="py-2 pl-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((i) => (
            <tr key={i.id} className="border-t border-dashed first:border-t-0">
              <td className="py-1.5 pr-2">
                {i.name}
                {i.kind === "SERVICE" ? <span className="ml-1 text-[10px] text-muted-foreground uppercase">service</span> : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{i.quantity}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{formatMoney(i.unitPrice, sym)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{formatMoney(i.lineTotal, sym)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 space-y-1 border-t border-dashed pt-3 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatMoney(bill.subtotal, sym)}</span>
        </div>
        {Number(bill.discount) > 0 ? (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span className="tabular-nums">− {formatMoney(bill.discount, sym)}</span>
          </div>
        ) : null}
        <div className="receipt-rule flex items-baseline justify-between border-y-2 py-2 text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(bill.total, sym)}</span>
        </div>
        {due ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid{bill.payments.length ? ` (${paymentMethodsLabel(bill.payments)})` : ""}</span>
              <span className="tabular-nums">{formatMoney(bill.amountPaid, sym)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold">
              <span>Balance due</span>
              <span className="tabular-nums">{formatMoney(bill.balanceDue, sym)}</span>
            </div>
          </>
        ) : byMethod.length > 1 ? (
          byMethod.map((p) => (
            <div key={p.method} className="flex justify-between">
              <span className="text-muted-foreground">Paid by {PAYMENT_LABEL[p.method]}</span>
              <span className="tabular-nums">{formatMoney(p.amount, sym)}</span>
            </div>
          ))
        ) : bill.payments.length ? (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid by</span>
            <span>{paymentMethodsLabel(bill.payments)}</span>
          </div>
        ) : null}
      </div>

      {due ? (
        <p className="receipt-rule mt-4 rounded-lg border-2 border-orange-400 px-3 py-2 text-center text-xs font-bold tracking-[0.2em] text-orange-700 uppercase dark:text-orange-300 print:text-black">
          Payment due
        </p>
      ) : null}

      {bill.notes ? <p className="mt-3 border-t border-dashed pt-3 text-xs text-muted-foreground">{bill.notes}</p> : null}

      {bill.status === "CANCELLED" ? (
        <p className="mt-4 rounded-lg border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-center text-xs font-semibold tracking-wide text-red-700 dark:text-red-300 uppercase print:bg-transparent">
          Cancelled
        </p>
      ) : null}

      <p className="mt-5 text-center text-xs font-medium">Thank you for visiting! Please come again.</p>
    </article>
  );
}
