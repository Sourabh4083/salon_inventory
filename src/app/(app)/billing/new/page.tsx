import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listServices } from "@/lib/services/billing";
import { getOpenBill, listBillingEmployees } from "@/lib/services/open-bills";
import { PageHeader } from "@/components/app/page-header";
import { BillComposer, type OpenBillInit } from "@/components/app/bill-composer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "New Bill" };

export default async function NewBillPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  await requirePermissionPage("bill.create");
  const { open: openId } = await searchParams;
  const openBill = openId ? await getOpenBill(openId) : null;
  // Completed or discarded on another device: back to the list.
  if (openId && !openBill) redirect("/billing");
  const [settings, services, employees] = await Promise.all([getSettings(), listServices({ activeOnly: true }), listBillingEmployees(openBill?.employeeId)]);

  const open: OpenBillInit | undefined = openBill
    ? {
        id: openBill.id,
        employeeId: openBill.employeeId,
        customerName: openBill.customerName ?? "",
        customerPhone: openBill.customerPhone ?? "",
        discount: openBill.discount,
        notes: openBill.notes ?? "",
        lines: openBill.lines,
      }
    : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title={openBill ? `Open bill · ${openBill.employeeName}` : "New Bill"}
        description={
          openBill
            ? "Add what has been used since, then keep it open again or complete the bill when the customer pays."
            : "Add the products and services the customer is paying for. Stock is reduced when the bill is completed."
        }
        actions={
          <Button variant="outline" size="lg" className="h-11" render={<Link href="/billing" />}>
            <ReceiptText /> All bills
          </Button>
        }
      />
      <BillComposer key={open?.id ?? "new"} services={services} currencySymbol={settings.currencySymbol} open={open} employees={employees} />
    </div>
  );
}
