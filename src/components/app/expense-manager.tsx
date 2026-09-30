"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { createExpenseAction, deleteExpenseAction, updateExpenseAction } from "@/app/actions/expenses";
import type { ExpenseDTO } from "@/lib/services/expenses";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { toDateParam } from "@/lib/dates";
import { trimMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type Values = { amount: string; description: string; spentOn: string; paymentMethod: PaymentMethod };

function ExpenseFields({
  values,
  set,
  errors,
  isOwner,
  currencySymbol,
  autoFocus,
}: {
  values: Values;
  set: (patch: Partial<Values>) => void;
  errors: Record<string, string>;
  isOwner: boolean;
  currencySymbol: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_2fr_1fr_1fr]">
      <Field label={`Amount (${currencySymbol})`} htmlFor={`${id}-amount`} required error={errors.amount}>
        <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={values.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="e.g. 120" autoFocus={autoFocus} aria-invalid={Boolean(errors.amount)} />
      </Field>
      <Field label="Spent on" htmlFor={`${id}-desc`} required error={errors.description}>
        <Input id={`${id}-desc`} className="h-11" value={values.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Tea & snacks, cleaning" maxLength={200} aria-invalid={Boolean(errors.description)} />
      </Field>
      <Field label="Paid by" htmlFor={`${id}-method`}>
        <NativeSelect id={`${id}-method`} className="h-11" value={values.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod })}>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card / bank</option>
        </NativeSelect>
      </Field>
      {isOwner ? (
        <Field label="Date" htmlFor={`${id}-date`} error={errors.spentOn}>
          <Input id={`${id}-date`} type="date" className="h-11" value={values.spentOn} max={toDateParam(new Date())} onChange={(e) => set({ spentOn: e.target.value })} />
        </Field>
      ) : null}
    </div>
  );
}

const blank = (): Values => ({ amount: "", description: "", spentOn: toDateParam(new Date()), paymentMethod: "CASH" });

/** Quick add form at the top of the Expenses page. */
export function ExpenseForm({ isOwner, currencySymbol }: { isOwner: boolean; currencySymbol: string }) {
  const [values, setValues] = useState<Values>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setError(null);
    start(async () => {
      const res = await createExpenseAction({ ...values, spentOn: isOwner ? values.spentOn : undefined });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Expense saved", { description: `${formatMoney(res.data.amount, currencySymbol)} · ${res.data.description}` });
      setValues(blank());
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <Wallet className="size-4.5 text-primary" /> Add expense
      </h2>
      <ExpenseFields values={values} set={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} isOwner={isOwner} currencySymbol={currencySymbol} />
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full sm:w-auto" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Save expense
      </Button>
    </form>
  );
}

export function ExpenseList({ expenses, currencySymbol, emptyText }: { expenses: ExpenseDTO[]; currencySymbol: string; emptyText: string }) {
  const [editing, setEditing] = useState<ExpenseDTO | null>(null);
  const [toDelete, setToDelete] = useState<ExpenseDTO | null>(null);
  const [deleting, startDelete] = useTransition();

  const remove = () => {
    if (!toDelete) return;
    const x = toDelete;
    startDelete(async () => {
      const res = await deleteExpenseAction(x.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Expense removed", { description: formatMoney(x.amount, currencySymbol) });
      setToDelete(null);
    });
  };

  if (expenses.length === 0) {
    return <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ul className="divide-y rounded-2xl border bg-card shadow-xs">
        {expenses.map((x) => (
          <li key={x.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{x.description}</span>
                <PaymentChip method={x.paymentMethod} />
              </p>
              <p className="text-xs text-muted-foreground">
                {x.canEdit ? formatDate(x.spentOn) : formatDateTime(x.createdAt)} · by {x.createdByName}
              </p>
            </div>
            <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(x.amount, currencySymbol)}</p>
            <div className="flex shrink-0 gap-1">
              {x.canEdit ? (
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label="Edit expense" onClick={() => setEditing(x)}>
                  <Pencil />
                </Button>
              ) : null}
              {x.canDelete ? (
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Delete expense" onClick={() => setToDelete(x)}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Edit expense</DialogTitle>
          </DialogHeader>
          {editing ? <EditExpense expense={editing} currencySymbol={currencySymbol} close={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this expense?</AlertDialogTitle>
            <AlertDialogDescription>{toDelete ? `${formatMoney(toDelete.amount, currencySymbol)} for “${toDelete.description}” will be removed.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={deleting} variant="destructive">
              {deleting ? <LoaderCircle className="animate-spin" /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditExpense({ expense, currencySymbol, close }: { expense: ExpenseDTO; currencySymbol: string; close: () => void }) {
  const [values, setValues] = useState<Values>({
    amount: trimMoney(Number(expense.amount).toFixed(2)),
    description: expense.description,
    spentOn: toDateParam(new Date(expense.spentOn)),
    paymentMethod: expense.paymentMethod,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setError(null);
    start(async () => {
      const res = await updateExpenseAction(expense.id, values);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Expense updated");
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ExpenseFields values={values} set={(p) => setValues((v) => ({ ...v, ...p }))} errors={errors} isOwner currencySymbol={currencySymbol} autoFocus />
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null} Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
