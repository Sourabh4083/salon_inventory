"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Banknote, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { addSalaryPaymentAction, deleteSalaryPaymentAction } from "@/app/actions/employees";
import { advanceTotalAction } from "@/app/actions/advances";
import { absenceCutAction } from "@/app/actions/attendance";
import type { EmployeeDTO, SalaryPaymentDTO } from "@/lib/services/employees";
import { formatMonth, isMonthParam, toDateParam, toMonthParam } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";
import { fromPaise, toPaise, trimMoney } from "@/lib/money";
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

function monthLabel(period: string | null) {
  return period ? formatMonth(period) : null;
}

export function SalaryPayments({
  employee,
  payments,
  paidThisYear,
  lastPaidOn,
  month,
  advances,
  absence,
  currencySymbol,
}: {
  employee: EmployeeDTO;
  payments: SalaryPaymentDTO[];
  paidThisYear: string;
  lastPaidOn: string | null;
  /** The month the page is showing ("2026-09"); the tiles and the payment form follow it. */
  month: string;
  /** Advances taken in that month. */
  advances: string;
  /** That month's attendance pay cut. */
  absence: { cutDays: number; deduction: string };
  currencySymbol: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SalaryPaymentDTO | null>(null);
  const [deleting, startDelete] = useTransition();

  const remove = () => {
    if (!toDelete) return;
    const p = toDelete;
    startDelete(async () => {
      const res = await deleteSalaryPaymentAction(employee.id, p.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Payment removed", { description: formatMoney(p.amount, currencySymbol) });
      setToDelete(null);
    });
  };

  const toPay = employee.monthlySalary ? fromPaise(toPaise(employee.monthlySalary) - toPaise(absence.deduction) - toPaise(advances)) : null;
  const inMonth = month === toMonthParam() ? "this month" : `in ${formatMonth(month)}`;
  const tiles = [
    { label: "Monthly salary", value: formatMoney(employee.monthlySalary, currencySymbol) },
    { label: `Cut for ${absence.cutDays} day${absence.cutDays === 1 ? "" : "s"} off ${inMonth}`, value: `− ${formatMoney(absence.deduction, currencySymbol)}` },
    { label: `Advances ${inMonth}`, value: `− ${formatMoney(advances, currencySymbol)}` },
    { label: month === toMonthParam() ? "To pay this month" : `To pay for ${formatMonth(month)}`, value: formatMoney(toPay, currencySymbol) },
    { label: `Paid in ${new Date().getFullYear()}`, value: formatMoney(paidThisYear, currencySymbol) },
    { label: "Last paid", value: lastPaidOn ? formatDate(lastPaidOn) : "—" },
  ];

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-heading text-lg">
          <Banknote className="size-4.5 text-primary" /> Salary
        </h2>
        <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
          <Plus /> Record payment
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-3 shadow-xs sm:p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl">{t.value}</p>
          </div>
        ))}
      </div>

      {payments.length ? (
        <ul className="divide-y rounded-2xl border bg-card shadow-xs">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {monthLabel(p.periodMonth) ? <span>Salary for {monthLabel(p.periodMonth)}</span> : <span>Salary payment</span>}
                  <PaymentChip method={p.paymentMethod} />
                </p>
                <p className="text-xs text-muted-foreground">
                  Paid {formatDate(p.paidOn)} · by {p.createdByName}
                  {p.absenceDeducted && toPaise(p.absenceDeducted) > 0 ? ` · ${formatMoney(p.absenceDeducted, currencySymbol)} cut for days off` : ""}
                  {p.advanceDeducted && toPaise(p.advanceDeducted) > 0 ? ` · ${formatMoney(p.advanceDeducted, currencySymbol)} advances deducted` : ""}
                  {p.note ? ` · “${p.note}”` : ""}
                </p>
              </div>
              <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(p.amount, currencySymbol)}</p>
              <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Delete payment" onClick={() => setToDelete(p)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No salary payments recorded yet.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Record salary payment</DialogTitle>
            <DialogDescription>{employee.name}</DialogDescription>
          </DialogHeader>
          {open ? <PaymentForm employee={employee} month={month} currencySymbol={currencySymbol} close={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete ? `${formatMoney(toDelete.amount, currencySymbol)} paid on ${formatDate(toDelete.paidOn)} will be removed from the salary history.` : ""}
            </AlertDialogDescription>
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

function PaymentForm({ employee, month, currencySymbol, close }: { employee: EmployeeDTO; month: string; currencySymbol: string; close: () => void }) {
  const id = useId();
  const [amount, setAmount] = useState(employee.monthlySalary ? trimMoney(employee.monthlySalary) : "");
  const [paidOn, setPaidOn] = useState(toDateParam(new Date()));
  const [periodMonth, setPeriodMonth] = useState(month);
  // Advances and the attendance pay cut for the chosen month; subtracted from the salary to suggest the amount.
  const [cuts, setCuts] = useState<{ month: string; advances: string; absence: string; absentDays: number } | null>(null);
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [note, setNote] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!isMonthParam(periodMonth)) return;
    let stale = false;
    void Promise.all([advanceTotalAction(employee.id, periodMonth), absenceCutAction(employee.id, periodMonth)]).then(([adv, abs]) => {
      if (stale || !adv.ok || !abs.ok) return;
      setCuts({ month: periodMonth, advances: adv.data, absence: abs.data.deduction, absentDays: abs.data.cutDays });
      if (employee.monthlySalary) setAmount(trimMoney(fromPaise(Math.max(0, toPaise(employee.monthlySalary) - toPaise(adv.data) - toPaise(abs.data.deduction)))));
    });
    return () => {
      stale = true;
    };
  }, [employee.id, employee.monthlySalary, periodMonth]);

  const current = cuts && cuts.month === periodMonth ? cuts : null;
  const deducted = current && toPaise(current.advances) > 0 ? current.advances : null;
  const absence = current && toPaise(current.absence) > 0 ? current.absence : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await addSalaryPaymentAction({ employeeId: employee.id, amount, paidOn, periodMonth, paymentMethod: method, note, advanceDeducted: deducted ?? undefined, absenceDeducted: absence ?? undefined });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Salary payment recorded", { description: `${formatMoney(res.data.amount, currencySymbol)} · ${employee.name}` });
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Amount (${currencySymbol})`} htmlFor={`${id}-amount`} required error={fieldErr.amount}>
          <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 15000" autoFocus aria-invalid={Boolean(fieldErr.amount)} />
        </Field>
        <Field label="Paid on" htmlFor={`${id}-date`} required error={fieldErr.paidOn}>
          <Input id={`${id}-date`} type="date" className="h-11 text-base" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-invalid={Boolean(fieldErr.paidOn)} />
        </Field>
        <Field label="Salary for month" htmlFor={`${id}-month`} error={fieldErr.periodMonth}>
          <Input id={`${id}-month`} type="month" className="h-11 text-base" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} aria-invalid={Boolean(fieldErr.periodMonth)} />
        </Field>
        <Field label="Paid by" htmlFor={`${id}-method`}>
          <NativeSelect id={`${id}-method`} className="h-11" value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "UPI" | "CARD")}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card / bank</option>
          </NativeSelect>
        </Field>
        {deducted || absence ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Salary {formatMoney(employee.monthlySalary, currencySymbol)}
            {absence ? ` − ${formatMoney(absence, currencySymbol)} for ${current!.absentDays} day${current!.absentDays === 1 ? "" : "s"} off` : ""}
            {deducted ? ` − advances ${formatMoney(deducted, currencySymbol)}` : ""} in {formatMonth(periodMonth)} ={" "}
            {formatMoney(fromPaise(toPaise(employee.monthlySalary) - toPaise(absence) - toPaise(deducted)), currencySymbol)}
          </p>
        ) : null}
        <Field label="Note (optional)" htmlFor={`${id}-note`} error={fieldErr.note} className="sm:col-span-2">
          <Input id={`${id}-note`} className="h-11" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Advance, bonus, deducted 2 days" maxLength={300} />
        </Field>
      </div>
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
          {pending ? <LoaderCircle className="animate-spin" /> : <Banknote />} Save payment
        </Button>
      </DialogFooter>
    </form>
  );
}
