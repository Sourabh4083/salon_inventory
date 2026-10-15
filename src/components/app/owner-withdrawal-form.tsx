"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { HandCoins, LoaderCircle, Save, Trash2 } from "lucide-react";
import { addOwnerWithdrawalAction, deleteOwnerWithdrawalAction, setOwnerNamesAction } from "@/app/actions/settings";
import { formatMoney } from "@/lib/format";
import { toDateParam } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
import { NativeSelect } from "@/components/app/native-select";
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
 * Owner: notes money one of the owners took from the shop for themselves. It comes off
 * Cash or Bank but is not shop spending, so profit stays as it is.
 */
export function OwnerWithdrawalForm({ ownerNames, currencySymbol }: { ownerNames: string[]; currencySymbol: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" variant="outline" className="h-11" onClick={() => setOpen(true)}>
        <HandCoins /> Owner took money
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Owner took money</DialogTitle>
            <DialogDescription>It comes off your cash or bank balance. It is not shop spending, so profit does not change.</DialogDescription>
          </DialogHeader>
          {open ? (
            ownerNames.length ? (
              <WithdrawalFields ownerNames={ownerNames} currencySymbol={currencySymbol} close={() => setOpen(false)} />
            ) : (
              <p className="text-sm">
                First type the owners&apos; names in{" "}
                <Link href="/settings" className="font-medium text-primary underline">
                  Settings
                </Link>
                .
              </p>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function WithdrawalFields({ ownerNames, currencySymbol, close }: { ownerNames: string[]; currencySymbol: string; close: () => void }) {
  const id = useId();
  const [ownerName, setOwnerName] = useState(ownerNames.length === 1 ? ownerNames[0] : "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [takenOn, setTakenOn] = useState(toDateParam(new Date()));
  const [note, setNote] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await addOwnerWithdrawalAction({ ownerName, amount, paymentMethod: method, takenOn, note });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Noted", { description: `${ownerName} took ${formatMoney(amount.replace(/[,\s]/g, ""), currencySymbol)}` });
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Who took it" required error={fieldErr.ownerName}>
        <div className="grid grid-cols-2 gap-2">
          {ownerNames.map((n) => (
            <Button key={n} type="button" size="lg" variant={ownerName === n ? "default" : "outline"} className="h-11 truncate" onClick={() => setOwnerName(n)} aria-pressed={ownerName === n}>
              {n}
            </Button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Amount (${currencySymbol})`} htmlFor={`${id}-amount`} required error={fieldErr.amount}>
          <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2000" aria-invalid={Boolean(fieldErr.amount)} />
        </Field>
        <Field label="Taken from" htmlFor={`${id}-method`}>
          <NativeSelect id={`${id}-method`} className="h-11" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="CASH">Cash drawer</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card / bank</option>
          </NativeSelect>
        </Field>
        <Field label="Date" htmlFor={`${id}-date`} error={fieldErr.takenOn}>
          <Input id={`${id}-date`} type="date" className="h-11 text-base" value={takenOn} max={toDateParam(new Date())} onChange={(e) => setTakenOn(e.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor={`${id}-note`} error={fieldErr.note}>
          <Input id={`${id}-note`} className="h-11" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Home expenses" maxLength={200} />
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
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending || !ownerName}>
          {pending ? <LoaderCircle className="animate-spin" /> : <HandCoins />} Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Removes money an owner took that was typed in by mistake. */
export function DeleteOwnerWithdrawal({ withdrawalId, label }: { withdrawalId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      const res = await deleteOwnerWithdrawalAction(withdrawalId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed", { description: "The money is back in the balance." });
      setOpen(false);
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Remove this entry">
        <Trash2 className="size-4" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
            <AlertDialogDescription>{label}. The amount goes back into the balance it came from.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={pending} variant="destructive">
              {pending ? <LoaderCircle className="animate-spin" /> : null} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Settings: the shop's two owners, picked when one of them takes money. */
export function OwnerNamesForm({ ownerNames }: { ownerNames: string[] }) {
  const id = useId();
  const [names, setNames] = useState([ownerNames[0] ?? "", ownerNames[1] ?? ""]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await setOwnerNamesAction({ names });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Owners saved");
    });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" noValidate>
      <h2 className="font-heading text-lg">Owners</h2>
      <p className="mt-1 text-sm text-muted-foreground">Used to note money an owner takes from the shop (Sales Reports → Cash vs Bank).</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {names.map((n, i) => (
          <Field key={i} label={`Owner ${i + 1}`} htmlFor={`${id}-${i}`}>
            <Input id={`${id}-${i}`} className="h-11" value={n} maxLength={60} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
          </Field>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" className="mt-4 h-11" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Save />} Save owners
      </Button>
    </form>
  );
}
