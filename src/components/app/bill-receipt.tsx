import type { BillDTO } from "@/lib/services/billing";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_LABEL } from "@/components/app/bill-badges";
import { cn } from "@/lib/utils";

/**
 * Receipt layout used on screen and for printing. On print, everything else on the
 * page is hidden (see globals.css) and this renders at thermal-receipt width.
 */
export function BillReceipt({ bill, businessName, currencySymbol, className }: { bill: BillDTO; businessName: string; currencySymbol: string; className?: string }) {
  const sym = currencySymbol;
  return (
    <article className={cn("receipt mx-auto w-full max-w-sm rounded-2xl border bg-card p-5 text-sm shadow-xs print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none", className)} aria-label={`Receipt ${bill.billNumber}`}>
      <header className="text-center">
        <h2 className="font-heading text-xl">{businessName}</h2>
        <p className="mt-1 text-xs text-muted-foreground">Receipt</p>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
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

      <table className="mt-4 w-full border-t border-dashed text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-2 text-left font-medium">Item</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Rate</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((i) => (
            <tr key={i.id} className="border-t border-dashed">
              <td className="py-1.5 pr-2">
                {i.name}
                {i.kind === "SERVICE" ? <span className="ml-1 text-[10px] text-muted-foreground uppercase">service</span> : null}
              </td>
              <td className="py-1.5 text-right tabular-nums">{i.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(i.unitPrice, sym)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(i.lineTotal, sym)}</td>
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
        <div className="flex items-baseline justify-between border-t pt-2 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(bill.total, sym)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Paid by</span>
          <span>{PAYMENT_LABEL[bill.paymentMethod]}</span>
        </div>
      </div>

      {bill.notes ? <p className="mt-3 border-t border-dashed pt-3 text-xs text-muted-foreground">{bill.notes}</p> : null}

      {bill.status === "CANCELLED" ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-center text-xs font-semibold tracking-wide text-red-700 uppercase print:bg-transparent">
          Cancelled
        </p>
      ) : null}

      <p className="mt-5 text-center text-xs text-muted-foreground">Thank you for visiting!</p>
    </article>
  );
}
