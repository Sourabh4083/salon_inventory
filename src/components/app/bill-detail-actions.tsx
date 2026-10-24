"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, LoaderCircle, MessageCircle, Pencil, Plus, Printer } from "lucide-react";
import { cancelBillAction, shareBillAction, turnOffShareLinkAction } from "@/app/actions/billing";
import type { BillDTO } from "@/lib/services/billing";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import { formatDate, formatMoney } from "@/lib/format";
import { whatsappLink } from "@/lib/phone";
import { buildBillWhatsappMessage } from "@/lib/bill-message";
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

export function BillDetailActions({
  bill,
  role,
  currencySymbol,
  businessName,
  shareExpiresAt,
}: {
  bill: BillDTO;
  role: Role;
  currencySymbol: string;
  businessName: string;
  /** When the customer's bill link stops working; null when no link is active. */
  shareExpiresAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [sharing, startShare] = useTransition();
  const canCancel = can(role, "bill.cancel") && bill.status === "COMPLETED";
  const canEdit = can(role, "bill.edit") && bill.status === "COMPLETED";
  const canShare = bill.status === "COMPLETED" && Boolean(bill.customerPhone);

  const sendOnWhatsapp = () => {
    // Opened before the server call: a window opened after an await is blocked as a popup.
    const win = window.open("", "_blank");
    startShare(async () => {
      const res = await shareBillAction(bill.id);
      if (!res.ok) {
        win?.close();
        toast.error(res.error);
        return;
      }
      const text = buildBillWhatsappMessage(bill, res.data.url, businessName, currencySymbol);
      const url = `${whatsappLink(bill.customerPhone!)}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = url;
      // wa.me is outside the app (it opens WhatsApp), so the router can't take it.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      else window.location.href = url;
    });
  };

  const turnOffLink = () => {
    startShare(async () => {
      const res = await turnOffShareLinkAction(bill.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Bill link turned off", { description: "The link sent to the customer no longer opens the bill." });
    });
  };

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
        {canShare ? (
          <Button size="lg" className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500" onClick={sendOnWhatsapp} disabled={sharing}>
            {sharing ? <LoaderCircle className="animate-spin" /> : <MessageCircle />} Send on WhatsApp
          </Button>
        ) : null}
        <Button size="lg" variant="outline" className="h-11" render={<Link href="/billing/new" />}>
          <Plus /> New bill
        </Button>
        {canEdit ? (
          <Button size="lg" variant="outline" className="h-11" render={<Link href={`/billing/${bill.id}/edit`} />}>
            <Pencil /> Edit bill
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="lg" variant="ghost" className="h-11 text-destructive hover:text-destructive sm:ml-auto" onClick={() => setOpen(true)}>
            <Ban /> Cancel bill
          </Button>
        ) : null}
      </div>

      {canCancel && shareExpiresAt ? (
        <p className="mt-2 text-xs text-muted-foreground print:hidden">
          Bill link sent to the customer works until {formatDate(shareExpiresAt)} ·{" "}
          <button type="button" className="font-medium text-destructive underline-offset-2 hover:underline disabled:opacity-50" onClick={turnOffLink} disabled={sharing}>
            Turn off link
          </button>
        </p>
      ) : null}

      {canCancel ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel {bill.billNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                The bill stays on record marked as cancelled, and every product on it goes back into stock. This cannot be undone.
                {Number(bill.balanceDue) > 0 && Number(bill.amountPaid) > 0
                  ? ` ${formatMoney(bill.amountPaid, currencySymbol)} was already received on this bill; return it to the customer.`
                  : ""}
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
