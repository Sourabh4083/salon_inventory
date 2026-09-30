"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { HandCoins, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { addBillPaymentAction, deleteBillPaymentAction } from "@/app/actions/billing";
import type { BillDTO, BillPaymentDTO } from "@/lib/services/billing";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { formatDateTime, formatMoney } from "@/lib/format";
import { trimMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
import { NativeSelect } from "@/components/app/native-select";
import { PaymentChip } from "@/components/app/bill-badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Money received on a pay-later bill and what is still owed. Owner and manager add
 * payments as the customer settles up; the bill is paid once the balance is zero.
 */
export function BillPayments({
  bill,
  canCollect,
  deletableIds,
  currencySymbol,
}: {
  bill: BillDTO;
  canCollect: boolean;
  /** Payments this viewer may remove (owner: any later payment; manager: their own from today). */
  deletableIds: string[];
  currencySymbol: string;
}) {
  const id = useId();
  const sym = currencySymbol;
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<BillPaymentDTO | null>(null);
  const [deleting, startDelete] = useTransition();
  const active = bill.status === "COMPLETED";
  const due = active && Number(bill.balanceDue) > 0;

  const remove = () => {
    if (!toDelete) return;
    const p = toDelete;
    startDelete(async () => {
      const res = await deleteBillPaymentAction(p.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Payment removed", { description: `${formatMoney(res.data.balanceDue, sym)} now due` });
      setToDelete(null);
    });
  };

  return (
    <section className="space-y-3 print:hidden" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-heading text-lg">
          <HandCoins className="size-4.5 text-primary" /> Payments
        </h2>
        {due && canCollect ? (
          <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
            <Plus /> Add payment
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="Bill total" value={formatMoney(bill.total, sym)} />
        <Tile label="Received" value={formatMoney(bill.amountPaid, sym)} />
        <Tile label={due ? "Balance due" : active ? "Fully paid" : "Balance"} value={formatMoney(bill.balanceDue, sym)} tone={due ? "due" : active ? "paid" : undefined} />
      </div>

      {bill.payments.length ? (
        <ul className="divide-y rounded-2xl border bg-card shadow-xs">
          {bill.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.atBilling ? "Paid at billing" : "Payment"} <PaymentChip method={p.method} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(p.paidAt)} · taken by {p.createdByName}
                </p>
              </div>
              <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(p.amount, sym)}</p>
              {active && deletableIds.includes(p.id) ? (
                <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove payment" onClick={() => setToDelete(p)}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing received yet.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Add payment</DialogTitle>
            <DialogDescription>
              {bill.billNumber}
              {bill.customerName ? ` · ${bill.customerName}` : ""} · {formatMoney(bill.balanceDue, sym)} due
            </DialogDescription>
          </DialogHeader>
          {open ? <PaymentForm bill={bill} currencySymbol={sym} close={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment?</AlertDialogTitle>
            <AlertDialogDescription>{toDelete ? `${formatMoney(toDelete.amount, sym)} will be added back to what ${bill.customerName ?? "the customer"} owes.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting} variant="destructive">
              {deleting ? <LoaderCircle className="animate-spin" /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "due" | "paid" }) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-3 shadow-xs sm:p-4",
        tone === "due" && "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200",
        tone === "paid" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
      )}
    >
      <p className={cn("text-xs", tone ? "opacity-80" : "text-muted-foreground")}>{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl">{value}</p>
    </div>
  );
}

function PaymentForm({ bill, currencySymbol, close }: { bill: BillDTO; currencySymbol: string; close: () => void }) {
  const id = useId();
  const [amount, setAmount] = useState(trimMoney(bill.balanceDue));
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await addBillPaymentAction({ billId: bill.id, amount, method });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      const left = Number(res.data.balanceDue);
      toast.success(left > 0 ? "Payment added" : `${bill.billNumber} fully paid`, {
        description: left > 0 ? `${formatMoney(res.data.balanceDue, currencySymbol)} still due` : `${formatMoney(amount, currencySymbol)} received`,
      });
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Amount (${currencySymbol})`} htmlFor={`${id}-amount`} required error={fieldErr.amount}>
          <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus aria-invalid={Boolean(fieldErr.amount)} />
        </Field>
        <Field label="Paid by" htmlFor={`${id}-method`}>
          <NativeSelect id={`${id}-method`} className="h-11" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </NativeSelect>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Enter less than the balance for a part payment.</p>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <HandCoins />} Save payment
        </Button>
      </DialogFooter>
    </form>
  );
}
