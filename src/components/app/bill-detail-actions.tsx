"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, LoaderCircle, Plus, Printer } from "lucide-react";
import { cancelBillAction } from "@/app/actions/billing";
import type { BillDTO } from "@/lib/services/billing";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function BillDetailActions({ bill, role }: { bill: BillDTO; role: Role }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canCancel = can(role, "bill.cancel") && bill.status === "COMPLETED";

  const cancel = () => {
    setError(null);
    start(async () => {
      const res = await cancelBillAction({ billId: bill.id, reason });
      if (!res.ok) {
        setError(res.fieldErrors?.reason ?? res.error);
        return;
      }
      toast.success(`${bill.billNumber} cancelled`, { description: "Product stock has been put back." });
      setOpen(false);
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button size="lg" className="h-11" onClick={() => window.print()}>
          <Printer /> Print receipt
        </Button>
        <Button size="lg" variant="outline" className="h-11" render={<Link href="/billing/new" />}>
          <Plus /> New bill
        </Button>
        {canCancel ? (
          <Button size="lg" variant="ghost" className="h-11 text-destructive hover:text-destructive sm:ml-auto" onClick={() => setOpen(true)}>
            <Ban /> Cancel bill
          </Button>
        ) : null}
      </div>

      {canCancel ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel {bill.billNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                The bill stays on record marked as cancelled, and every product on it goes back into stock. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field label="Reason" htmlFor="cancel-reason" required error={error ?? undefined}>
              <Input id="cancel-reason" className="h-11" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer returned the items" maxLength={300} aria-invalid={Boolean(error)} />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep bill</AlertDialogCancel>
              <AlertDialogAction onClick={cancel} disabled={pending || reason.trim().length < 3} variant="destructive">
                {pending ? <LoaderCircle className="animate-spin" /> : null}
                Cancel bill
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
