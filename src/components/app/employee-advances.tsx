"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { deleteAdvanceAction, recordAdvanceAction } from "@/app/actions/advances";
import type { AdvanceDTO } from "@/lib/services/advances";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatMonth, toDateParam } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
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
 * Money the employee took from the shop. Manager and owner browse any month and see its
 * total, which is deducted at salary time; the manager adds entries for today only.
 */
export function EmployeeAdvances({
  employeeId,
  employeeName,
  advances,
  total,
  month,
  isOwner,
  canAdd,
  currencySymbol,
}: {
  employeeId: string;
  employeeName: string;
  advances: AdvanceDTO[];
  total: string;
  /** The month being shown ("2026-09"); enables the month picker and total. */
  month?: string;
  isOwner: boolean;
  canAdd: boolean;
  currencySymbol: string;
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AdvanceDTO | null>(null);
  const [deleting, startDelete] = useTransition();
  const [switching, startSwitch] = useTransition();

  const setMonth = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("month", value);
    else next.delete("month");
    startSwitch(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const remove = () => {
    if (!toDelete) return;
    const a = toDelete;
    startDelete(async () => {
      const res = await deleteAdvanceAction(a.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Entry removed", { description: formatMoney(a.amount, currencySymbol) });
      setToDelete(null);
    });
  };

  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="flex items-center gap-2 font-heading text-lg">
          <HandCoins className="size-4.5 text-primary" /> Advances
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {month ? (
            <Input type="month" className="h-11 w-44" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
          ) : null}
          {canAdd ? (
            <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
              <Plus /> Give advance
            </Button>
          ) : null}
        </div>
      </div>

      {isOwner && month ? (
        <div className="rounded-2xl border bg-card p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Taken in {formatMonth(month)}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(total, currencySymbol)}</p>
        </div>
      ) : (
        // The manager's page shows the month's total in the salary tiles above.
        <p className="text-sm text-muted-foreground">Note any money {employeeName} takes from the shop today. The owner deducts it from the salary at month end.</p>
      )}

      {advances.length ? (
        <ul className={`divide-y rounded-2xl border bg-card shadow-xs ${switching ? "opacity-60" : ""}`}>
          {advances.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.note ?? "Advance"}</p>
                <p className="text-xs text-muted-foreground">
                  {month ? formatDate(a.takenOn) : formatDateTime(a.createdAt)} · noted by {a.createdByName}
                </p>
              </div>
              <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(a.amount, currencySymbol)}</p>
              {a.canDelete ? (
                <Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove entry" onClick={() => setToDelete(a)}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {month ? `No advances in ${formatMonth(month)}.` : "Nothing noted today."}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Give advance</DialogTitle>
            <DialogDescription>{employeeName}</DialogDescription>
          </DialogHeader>
          {open ? (
            <AdvanceForm
              employeeId={employeeId}
              isOwner={isOwner}
              currencySymbol={currencySymbol}
              close={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
            <AlertDialogDescription>{toDelete ? `${formatMoney(toDelete.amount, currencySymbol)} will no longer count against ${employeeName}'s salary.` : ""}</AlertDialogDescription>
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

function AdvanceForm({
  employeeId,
  isOwner,
  currencySymbol,
  close,
}: {
  employeeId: string;
  isOwner: boolean;
  currencySymbol: string;
  close: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [takenOn, setTakenOn] = useState(toDateParam(new Date()));
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await recordAdvanceAction({ employeeId, amount, note, takenOn: isOwner ? takenOn : undefined });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Advance noted", { description: formatMoney(res.data.amount, currencySymbol) });
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Amount (${currencySymbol})`} htmlFor={`${id}-amount`} required error={fieldErr.amount}>
          <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" autoFocus aria-invalid={Boolean(fieldErr.amount)} />
        </Field>
        {isOwner ? (
          <Field label="Date" htmlFor={`${id}-date`} error={fieldErr.takenOn}>
            <Input id={`${id}-date`} type="date" className="h-11 text-base" value={takenOn} max={toDateParam(new Date())} onChange={(e) => setTakenOn(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Note (optional)" htmlFor={`${id}-note`} error={fieldErr.note} className="sm:col-span-2">
          <Input id={`${id}-note`} className="h-11" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bus fare, medicine" maxLength={300} />
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
          {pending ? <LoaderCircle className="animate-spin" /> : <HandCoins />} Save
        </Button>
      </DialogFooter>
    </form>
  );
}
