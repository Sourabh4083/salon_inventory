import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getOrder } from "@/lib/services/orders";
import { PageHeader } from "@/components/app/page-header";
import { OrderForm } from "@/components/app/order-form";
import { Button } from "@/components/ui/button";
import { trimMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Edit Order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionPage("order.manage");
  const { id } = await params;
  const [settings, order] = await Promise.all([getSettings(), getOrder(id)]);
  if (!order) notFound();
  // Once anything has been booked in, the order is history and can only be closed.
  if (order.status !== "ACTIVE" || order.totalReceived > 0) redirect(`/orders/${id}`);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground" render={<Link href={`/orders/${id}`} />}>
          <ArrowLeft /> {order.orderNumber}
        </Button>
        <PageHeader title={`Edit ${order.orderNumber}`} description="Change the products or quantities. Nothing has been received yet." />
      </div>
      <OrderForm
        currencySymbol={settings.currencySymbol}
        initial={{
          orderId: order.id,
          orderNumber: order.orderNumber,
          notes: order.notes ?? "",
          lines: order.items
            .filter((i) => i.productId)
            .map((i) => ({ productId: i.productId!, name: i.name, inStock: i.inStock ?? 0, quantity: i.quantityOrdered, unitCost: i.unitCost ? trimMoney(i.unitCost) : "" })),
        }}
      />
    </div>
  );
}
