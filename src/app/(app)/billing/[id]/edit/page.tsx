import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import { getBill, listServices } from "@/lib/services/billing";
import { zonedParts } from "@/lib/timezone";
import { fromPaise, toPaise, trimMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { BillComposer, type BillEditInit } from "@/components/app/bill-composer";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Edit Bill" };

/** "2026-09-27T18:30" for a datetime-local input, in the salon's zone. */
function toLocalInput(iso: string) {
  const p = zonedParts(new Date(iso));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermissionPage("bill.edit");
  const { id } = await params;
  const [settings, services, bill] = await Promise.all([getSettings(), listServices({ activeOnly: true }), getBill(id)]);
  if (!bill) notFound();
  if (bill.status === "CANCELLED") redirect(`/billing/${id}`);

  const originalQty: Record<string, number> = {};
  for (const i of bill.items) if (i.kind === "PRODUCT" && i.productId) originalQty[i.productId] = (originalQty[i.productId] ?? 0) + i.quantity;
  const stock = new Map(
    (await prisma.product.findMany({ where: { id: { in: Object.keys(originalQty) } }, select: { id: true, quantity: true } })).map((p) => [p.id, p.quantity]),
  );

  const counter = bill.payments.find((p) => p.atBilling);
  const collectedLater = bill.payments.filter((p) => !p.atBilling).reduce((n, p) => n + toPaise(p.amount), 0);
  // Anything short of the full total at the counter was a pay-later bill.
  const payLater = Number(bill.total) > 0 && (!counter || counter.amount !== bill.total);

  const edit: BillEditInit = {
    billId: bill.id,
    billNumber: bill.billNumber,
    billedAt: toLocalInput(bill.createdAt),
    customerName: bill.customerName ?? "",
    customerPhone: bill.customerPhone ?? "",
    discount: Number(bill.discount) > 0 ? trimMoney(bill.discount) : "",
    paymentMethod: counter?.method ?? bill.paymentMethod ?? "CASH",
    payLater,
    paidNow: payLater && counter ? trimMoney(counter.amount) : "",
    collectedLater: collectedLater > 0 ? fromPaise(collectedLater) : null,
    notes: bill.notes ?? "",
    originalQty,
    lines: bill.items.map((i) =>
      i.kind === "PRODUCT" && i.productId
        ? { kind: "PRODUCT", productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: trimMoney(i.unitPrice), available: (stock.get(i.productId) ?? 0) + originalQty[i.productId] }
        : { kind: "SERVICE", serviceId: i.serviceId, name: i.name, quantity: i.quantity, unitPrice: trimMoney(i.unitPrice) },
    ),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${bill.billNumber}`}
        description="Change items, prices, discount, customer or the bill date. Stock, sales reports and profit update to match."
        actions={
          <Button variant="outline" size="lg" className="h-11" render={<Link href={`/billing/${bill.id}`} />}>
            <ArrowLeft /> Back to bill
          </Button>
        }
      />
      <BillComposer services={services} currencySymbol={settings.currencySymbol} edit={edit} />
    </div>
  );
}
