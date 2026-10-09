import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listCategories } from "@/lib/services/products";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { OrderForm } from "@/components/app/order-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "New Order" };

export default async function NewOrderPage() {
  const user = await requirePermissionPage("order.create");
  const [settings, categories] = await Promise.all([getSettings(), listCategories()]);
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
      <OrderForm
        currencySymbol={settings.currencySymbol}
        categories={categories}
        globalThreshold={settings.lowStockThreshold}
        isOwner={user.role === "OWNER"}
        showCost={can(user.role, "product.cost.view")}
      />
    </div>
  );
}
