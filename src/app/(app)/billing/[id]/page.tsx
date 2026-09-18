import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getBill } from "@/lib/services/billing";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { BillReceipt } from "@/components/app/bill-receipt";
import { BillDetailActions } from "@/components/app/bill-detail-actions";
import { BillStatusBadge } from "@/components/app/bill-badges";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Bill" };

export default async function BillDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const user = await requirePermissionPage("bill.view");
  const [{ id }, { new: isNew }] = await Promise.all([params, searchParams]);
  const [settings, bill] = await Promise.all([getSettings(), getBill(id)]);
  if (!bill) notFound();

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
        {bill.status === "CANCELLED" ? (
          <p role="status" className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            Cancelled {bill.cancelledAt ? formatDateTime(bill.cancelledAt) : ""} by {bill.cancelledByName ?? "owner"}: {bill.cancelReason}. Product stock was restored.
          </p>
        ) : null}
        <BillDetailActions bill={bill} role={user.role} />
      </div>

      <BillReceipt bill={bill} businessName={settings.businessName} currencySymbol={settings.currencySymbol} />
    </div>
  );
}
