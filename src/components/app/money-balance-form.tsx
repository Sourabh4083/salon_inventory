"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, Pencil } from "lucide-react";
import { setBalancesAction } from "@/app/actions/settings";
import { trimMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";

/**
 * Owner: types what is in the cash drawer and the bank right now. Used once to start
 * the running balances, and again to correct them when the real amounts differ.
 */
export function MoneyBalanceForm({ cash, bank, currencySymbol }: { cash: string | null; bank: string | null; currencySymbol: string }) {
  const [open, setOpen] = useState(false);
  const isSet = cash !== null;
  return (
    <>
      <Button size="lg" variant={isSet ? "outline" : "default"} className="h-11" onClick={() => setOpen(true)}>
        <Pencil /> {isSet ? "Correct balance" : "Set balance"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">{isSet ? "Correct the balance" : "Set your balance"}</DialogTitle>
            <DialogDescription>
              Count the cash in the drawer and check your bank balance, then type both. From now on every payment received is added and every payment made is taken away.
            </DialogDescription>
          </DialogHeader>
          {open ? <BalanceFields cash={cash} bank={bank} currencySymbol={currencySymbol} close={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function BalanceFields({ cash, bank, currencySymbol, close }: { cash: string | null; bank: string | null; currencySymbol: string; close: () => void }) {
  const id = useId();
  const [values, setValues] = useState({ cash: cash ? trimMoney(cash) : "", bank: bank ? trimMoney(bank) : "" });
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await setBalancesAction(values);
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Balance saved");
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Cash in drawer (${currencySymbol})`} htmlFor={`${id}-cash`} required error={fieldErr.cash}>
          <Input id={`${id}-cash`} className="h-11 text-base" inputMode="decimal" value={values.cash} onChange={(e) => setValues({ ...values, cash: e.target.value })} placeholder="e.g. 5000" autoFocus aria-invalid={Boolean(fieldErr.cash)} />
        </Field>
        <Field label={`In bank (${currencySymbol})`} htmlFor={`${id}-bank`} required error={fieldErr.bank}>
          <Input id={`${id}-bank`} className="h-11 text-base" inputMode="decimal" value={values.bank} onChange={(e) => setValues({ ...values, bank: e.target.value })} placeholder="e.g. 20000" aria-invalid={Boolean(fieldErr.bank)} />
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
          {pending ? <LoaderCircle className="animate-spin" /> : null} Save
        </Button>
      </DialogFooter>
    </form>
  );
}
