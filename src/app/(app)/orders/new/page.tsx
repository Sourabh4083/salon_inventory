import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { OrderForm } from "@/components/app/order-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "New Order" };

export default async function NewOrderPage() {
  await requirePermissionPage("order.manage");
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="New Order"
        description="List the products you're ordering. Stock doesn't change until you mark them received."
        actions={
          <Button variant="outline" size="lg" className="h-11" render={<Link href="/orders" />}>
            <Truck /> All orders
          </Button>
        }
      />
      <OrderForm currencySymbol={settings.currencySymbol} />
    </div>
  );
}
