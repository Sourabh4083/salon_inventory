"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Landmark, LoaderCircle, Trash2 } from "lucide-react";
import { deleteCashDepositAction, moveCashToBankAction } from "@/app/actions/settings";
import { formatMoney } from "@/lib/format";
import { trimMoney } from "@/lib/money";
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
 * Owner: the cash taken from the drawer to the bank. The box starts with everything
 * in the drawer; type less to leave some behind.
 */
export function CashToBankForm({ cash, currencySymbol }: { cash: string; currencySymbol: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
        <Landmark /> Move cash to bank
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Move cash to bank</DialogTitle>
            <DialogDescription>
              Cash in drawer now: {formatMoney(cash, currencySymbol)}. This amount leaves the drawer and is added to your bank balance.
            </DialogDescription>
          </DialogHeader>
          {open ? <AmountField cash={cash} currencySymbol={currencySymbol} close={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AmountField({ cash, currencySymbol, close }: { cash: string; currencySymbol: string; close: () => void }) {
  const id = useId();
  const [amount, setAmount] = useState(trimMoney(cash));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await moveCashToBankAction({ amount });
      if (!res.ok) {
        setError(res.fieldErrors?.amount ?? res.error);
        return;
      }
      toast.success("Moved to bank");
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={`Amount to move (${currencySymbol})`} htmlFor={`${id}-amount`} required error={error ?? undefined}>
        <Input id={`${id}-amount`} className="h-11 text-base" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onFocus={(e) => e.currentTarget.select()} autoFocus aria-invalid={Boolean(error)} />
      </Field>
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null} Move
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Passbook: removes a cash-to-bank move typed in by mistake. */
export function DeleteCashDeposit({ depositId, amount }: { depositId: string; amount: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      const res = await deleteCashDepositAction(depositId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed", { description: "The cash is back in the drawer." });
      setOpen(false);
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Remove this move to bank">
        <Trash2 className="size-4" />
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this move to bank?</AlertDialogTitle>
            <AlertDialogDescription>{amount} goes back to the cash drawer and comes off the bank balance.</AlertDialogDescription>
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
