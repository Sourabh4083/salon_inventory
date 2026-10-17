"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle, Minus, Plus, Trash2, Truck } from "lucide-react";
import { createOrderAction, orderPickerProductsAction, updateOrderAction, updateOrderCostsAction } from "@/app/actions/orders";
import type { ProductDTO } from "@/lib/services/products";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { PAYMENT_LABEL } from "@/components/app/bill-badges";
import { NativeSelect } from "@/components/app/native-select";
import { formatMoney } from "@/lib/format";
import { fromPaise, toPaise, trimMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { ProductPickerDialog } from "@/components/app/product-picker-dialog";
import { ProductForm } from "@/components/app/product-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type OrderFormLine = {
  itemId?: string;
  productId: string;
  name: string;
  inStock: number;
  quantity: number;
  unitCost: string; // human-typed, e.g. "400"
};

export function OrderForm({
  currencySymbol,
  categories,
  globalThreshold,
  isOwner,
  showCost,
  initial,
  costsOnly = false,
}: {
  /** The order has had deliveries: only the cost per unit, GST and note can change. */
  costsOnly?: boolean;
  currencySymbol: string;
  /** For adding a product that isn't in the inventory yet, right from the order. */
  categories: { id: string; name: string }[];
  globalThreshold: number;
  isOwner: boolean;
  /** Costs are owner-only; the manager orders by product and quantity alone. */
  showCost: boolean;
  /** Present when editing an existing order. paymentMethod is null on an older order paid on delivery. */
  initial?: { orderId: string; orderNumber: string; notes: string; cgst: string; sgst: string; paymentMethod: PaymentMethod | null; lines: OrderFormLine[] };
}) {
  const router = useRouter();
  // An older order is paid when it arrives, so it has nothing to choose here.
  const paidOnOrder = !initial || initial.paymentMethod !== null;
  const [method, setMethod] = useState<PaymentMethod>(initial?.paymentMethod ?? "CASH");
  const [lines, setLines] = useState<OrderFormLine[]>(initial?.lines ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [cgst, setCgst] = useState(initial?.cgst ?? "");
  const [sgst, setSgst] = useState(initial?.sgst ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  // null = closed; otherwise the name typed in the picker's search box.
  const [newProductName, setNewProductName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const totals = useMemo(
    () => ({
      units: lines.reduce((n, l) => n + l.quantity, 0),
      cost: lines.reduce((n, l) => n + toPaise(l.unitCost) * l.quantity, 0) + toPaise(cgst) + toPaise(sgst),
    }),
    [lines, cgst, sgst],
  );

  const addProduct = (p: ProductDTO, quantity = 1) =>
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + quantity } : l));
      return [...prev, { productId: p.id, name: p.name, inStock: p.quantity, quantity, unitCost: p.costPrice ? trimMoney(Number(p.costPrice).toFixed(2)) : "" }];
    });

  const update = (productId: string, patch: Partial<OrderFormLine>) => setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  const remove = (productId: string) => setLines((prev) => prev.filter((l) => l.productId !== productId));

  const submit = () => {
    setError(null);
    if (!lines.length) return setError("Add at least one product.");
    start(async () => {
      if (costsOnly && initial) {
        const res = await updateOrderCostsAction(initial.orderId, { items: lines.map((l) => ({ itemId: l.itemId!, unitCost: l.unitCost })), notes, cgst, sgst });
        if (!res.ok) {
          setError(res.error);
          toast.error(res.error);
          return;
        }
        toast.success(`${res.data.orderNumber} updated`, { description: "Cash vs Bank and the reports now use these amounts." });
        router.push(`/orders/${initial.orderId}`);
        return;
      }
      const payload = { items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: showCost ? l.unitCost : "" })),
        notes,
        cgst: showCost ? cgst : "",
        sgst: showCost ? sgst : "",
        paymentMethod: method,
      };
      const res = initial ? await updateOrderAction(initial.orderId, payload) : await createOrderAction(payload);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(initial ? `${res.data.orderNumber} updated` : `${res.data.orderNumber} placed`, {
        description: `${paidOnOrder ? `Paid by ${PAYMENT_LABEL[method]}. ` : ""}Click Received on the Orders page when the products arrive.`,
      });
      router.push("/orders");
    });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
          <h2 className="font-heading text-lg">{costsOnly ? "Cost per unit" : "Products to order"}</h2>
          {costsOnly ? null : (
            <Button type="button" size="lg" className="h-11" onClick={() => setPickerOpen(true)}>
              <Plus /> Add product
            </Button>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            No products yet. Click “Add product” — out-of-stock and low-stock products are listed first, and you can add a new product from there too.
          </p>
        ) : (
          <ul className="divide-y">
            {lines.map((l) => (
              <li key={l.productId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">{l.inStock} in stock now</p>
                </div>
                <div className="flex items-center gap-2">
                  {costsOnly ? (
                    <span className="text-sm text-muted-foreground tabular-nums">× {l.quantity}</span>
                  ) : (
                    <div className="flex items-center rounded-xl border">
                      <button type="button" className="flex size-10 items-center justify-center rounded-l-xl hover:bg-muted disabled:opacity-40" onClick={() => update(l.productId, { quantity: Math.max(1, l.quantity - 1) })} disabled={l.quantity <= 1} aria-label={`Decrease ${l.name}`}>
                        <Minus className="size-4" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={l.quantity}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => update(l.productId, { quantity: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1) })}
                        className="h-10 w-14 border-x bg-background text-center text-base font-semibold tabular-nums outline-none"
                        aria-label={`Quantity of ${l.name}`}
                      />
                      <button type="button" className="flex size-10 items-center justify-center rounded-r-xl hover:bg-muted" onClick={() => update(l.productId, { quantity: l.quantity + 1 })} aria-label={`Increase ${l.name}`}>
                        <Plus className="size-4" />
                      </button>
                    </div>
                  )}
                  {showCost ? (
                    <div className="relative w-28">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                      <Input
                        inputMode="decimal"
                        value={l.unitCost}
                        onChange={(e) => update(l.productId, { unitCost: e.target.value })}
                        placeholder="Cost"
                        className="h-10 pl-7 tabular-nums"
                        aria-label={`Cost per unit of ${l.name}`}
                      />
                    </div>
                  ) : null}
                  {costsOnly ? null : (
                    <button type="button" onClick={() => remove(l.productId)} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove ${l.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showCost ? (
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="font-heading text-lg">GST on the bill</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {paidOnOrder
              ? "Leave blank if the bill has no GST. It is paid with the order."
              : costsOnly
                ? "Leave blank if the bill has no GST. It counts as paid with the first delivery."
                : "Leave blank if the bill has no GST. You can also fill this in when the products arrive."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <GstInput id="order-cgst" label="CGST" value={cgst} onChange={setCgst} currencySymbol={currencySymbol} />
            <GstInput id="order-sgst" label="SGST" value={sgst} onChange={setSgst} currencySymbol={currencySymbol} />
          </div>
        </section>
      ) : null}

      {paidOnOrder && !costsOnly ? (
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <PaidBy id="order-paid-by" value={method} onChange={setMethod} />
          <p className="mt-2 text-sm text-muted-foreground">The order is paid for now, so the amount comes off {method === "CASH" ? "Cash" : "Bank"} today.</p>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
        <Field label="Note (optional)" htmlFor="order-notes" hint="e.g. where you ordered from, or when it should arrive.">
          <Textarea id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} placeholder="e.g. Ordered from Ravi Traders, delivery Friday" />
        </Field>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {lines.length} {lines.length === 1 ? "product" : "products"} · {totals.units} {totals.units === 1 ? "unit" : "units"}
          {showCost && totals.cost > 0 ?` · about ${formatMoney(fromPaise(totals.cost), currencySymbol)}` : ""}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button size="lg" className="h-12 text-base" onClick={submit} disabled={pending || lines.length === 0}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Truck />}
            {initial ? "Save changes" : "Place order"}
          </Button>
        </div>
      </div>

      <ProductPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add a product"
        description="Out-of-stock products first, then low stock, then the rest. Or search by name, SKU or barcode."
        currencySymbol={currencySymbol}
        search={orderPickerProductsAction}
        onPick={(p) => {
          addProduct(p);
          setPickerOpen(false);
        }}
        onCreateNew={(name) => {
          setPickerOpen(false);
          setNewProductName(name);
        }}
      />

      <Dialog open={newProductName !== null} onOpenChange={(open) => (open ? null : setNewProductName(null))}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Add new product</DialogTitle>
            <DialogDescription>It is saved in the inventory with 0 stock and added to this order. Stock goes up when the order is received.</DialogDescription>
          </DialogHeader>
          {newProductName !== null ? (
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <ProductForm
                categories={categories}
                currencySymbol={currencySymbol}
                isOwner={isOwner}
                globalThreshold={globalThreshold}
                defaultName={newProductName}
                hideStartingStock
                onCancel={() => setNewProductName(null)}
                onSaved={(p) => {
                  addProduct(p);
                  setNewProductName(null);
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** How the shop paid for an order, so its cost comes off the right balance. */
export function PaidBy({ id, value, onChange }: { id: string; value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <Field label="Paid by" htmlFor={id}>
      <NativeSelect id={id} className="h-11" value={value} onChange={(e) => onChange(e.target.value as PaymentMethod)}>
        <option value="CASH">Cash</option>
        <option value="UPI">UPI</option>
        <option value="CARD">Card / bank</option>
      </NativeSelect>
    </Field>
  );
}

export function GstInput({ id, label, value, onChange, currencySymbol }: { id: string; label: string; value: string; onChange: (v: string) => void; currencySymbol: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
        <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="h-11 pl-7 tabular-nums" />
      </div>
    </Field>
  );
}
