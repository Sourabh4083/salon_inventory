import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listServices } from "@/lib/services/billing";
import { PageHeader } from "@/components/app/page-header";
import { BillComposer } from "@/components/app/bill-composer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "New Bill" };

export default async function NewBillPage() {
  await requirePermissionPage("bill.create");
  const [settings, services] = await Promise.all([getSettings(), listServices({ activeOnly: true })]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="New Bill"
        description="Add the products and services the customer is paying for. Stock is reduced when the bill is completed."
        actions={
          <Button variant="outline" size="lg" className="h-11" render={<Link href="/billing" />}>
            <ReceiptText /> All bills
          </Button>
        }
      />
      <BillComposer services={services} currencySymbol={settings.currencySymbol} />
    </div>
  );
}
