import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { billForViewer, getBill, getOriginalBillSummary, mayDeletePayment } from "@/lib/services/billing";
import { can } from "@/lib/permissions";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { BillReceipt } from "@/components/app/bill-receipt";
import { BillDetailActions } from "@/components/app/bill-detail-actions";
import { BillPayments } from "@/components/app/bill-payments";
import { BillStatusBadge } from "@/components/app/bill-badges";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Bill" };

export default async function BillDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermissionPage("bill.view");
  const [{ id }, { new: isNew }] = await Promise.all([params, searchParams]);
  const [settings, found] = await Promise.all([getSettings(), getBill(id)]);
  if (!found) notFound();
  const bill = billForViewer(found, user.role);
  const original = bill.editedAt ? await getOriginalBillSummary(bill.id) : null;
  // A bill paid in full at the counter needs no payments section; the receipt says how it was paid.
  const paidAtCounter = bill.payments.length === 1 && bill.payments[0].atBilling && bill.payments[0].amount === bill.total;
  const showPayments = Number(bill.total) > 0 && !paidAtCounter;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="print:hidden">
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground" render={<Link href="/billing" />}>
          <ArrowLeft /> All bills
        </Button>
        <PageHeader
          title={bill.billNumber}
          description={
            <span className="flex flex-wrap items-center gap-2">
              {formatDateTime(bill.createdAt)} · billed by {bill.createdByName}
              <BillStatusBadge status={bill.status} />
            </span>
          }
        />
        {isNew && bill.status === "COMPLETED" ? (
          <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="size-4.5 shrink-0" /> Bill saved and stock updated. Print the receipt or start the next bill.
          </p>
        ) : null}
        {bill.editedAt ? (
          <p role="status" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Edited {formatDateTime(bill.editedAt)} by {bill.editedByName ?? "owner"}
            {original ? ` · originally ${formatMoney(original.total, settings.currencySymbol)} on ${formatDateTime(original.createdAt)}` : ""}. Only you can see this note.
          </p>
        ) : null}
        {bill.status === "CANCELLED" ? (
          <p role="status" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            Cancelled {bill.cancelledAt ? formatDateTime(bill.cancelledAt) : ""} by {bill.cancelledByName ?? "owner"}: {bill.cancelReason}. Product stock was restored.
          </p>
        ) : null}
        <BillDetailActions bill={bill} role={user.role} currencySymbol={settings.currencySymbol} />
      </div>

      {showPayments ? (
        <BillPayments
          bill={bill}
          canCollect={can(user.role, "bill.collect")}
          deletableIds={bill.payments.filter((p) => mayDeletePayment({ ...p, createdAt: p.paidAt }, user)).map((p) => p.id)}
          currencySymbol={settings.currencySymbol}
        />
      ) : null}

      <BillReceipt bill={bill} businessName={settings.businessName} currencySymbol={settings.currencySymbol} />
    </div>
  );
}
