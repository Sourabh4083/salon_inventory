import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getOrder } from "@/lib/services/orders";
import { listCategories } from "@/lib/services/products";
import { PageHeader } from "@/components/app/page-header";
import { OrderForm } from "@/components/app/order-form";
import { Button } from "@/components/ui/button";
import { trimMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Edit Order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionPage("order.manage");
  const { id } = await params;
  const [settings, order, categories] = await Promise.all([getSettings(), getOrder(id), listCategories()]);
  if (!order) notFound();
  // Once anything has been booked in, products and quantities are fixed; only the money can be corrected.
  const costsOnly = order.status !== "ACTIVE" || order.totalReceived > 0;
  if (costsOnly && order.totalReceived === 0) redirect(`/orders/${id}`);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground" render={<Link href={`/orders/${id}`} />}>
          <ArrowLeft /> {order.orderNumber}
        </Button>
        <PageHeader
          title={`Edit ${order.orderNumber}`}
          description={
            costsOnly
              ? "Products have already arrived, so only the cost per unit, GST and note can be changed. Stock stays as it is."
              : "Change the products or quantities. Nothing has been received yet."
          }
        />
      </div>
      <OrderForm
        currencySymbol={settings.currencySymbol}
        categories={categories}
        globalThreshold={settings.lowStockThreshold}
        // Editing an order is owner-only (order.manage above).
        isOwner
        showCost
        costsOnly={costsOnly}
        initial={{
          orderId: order.id,
          orderNumber: order.orderNumber,
          notes: order.notes ?? "",
          cgst: order.cgst ? trimMoney(order.cgst) : "",
          sgst: order.sgst ? trimMoney(order.sgst) : "",
          lines: order.items
            .filter((i) => i.productId)
            .map((i) => ({ itemId: i.id, productId: i.productId!, name: i.name, inStock: i.inStock ?? 0, quantity: i.quantityOrdered, unitCost: i.unitCost ? trimMoney(i.unitCost) : "" })),
        }}
      />
    </div>
  );
}
