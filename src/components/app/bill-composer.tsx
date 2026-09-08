"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, CreditCard, LoaderCircle, Minus, Plus, Receipt, Scissors, Search, Smartphone, Trash2, X } from "lucide-react";
import { lookupProductByCodeAction, quickSearchProductsAction } from "@/app/actions/products";
import { createBillAction } from "@/app/actions/billing";
import type { ProductDTO } from "@/lib/services/products";
import type { ServiceDTO } from "@/lib/services/billing";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/format";
import { fromPaise, toPaise, trimMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";
import { StockBadge } from "@/components/app/stock-badge";

type Line = {
  key: string;
  kind: "PRODUCT" | "SERVICE";
  productId?: string;
  serviceId?: string | null;
  name: string;
  quantity: number;
  unitPrice: string; // human-typed, e.g. "600"
  available?: number; // products only
};

const PAYMENTS: { value: PaymentMethod; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "UPI", label: "UPI", icon: Smartphone },
  { value: "CARD", label: "Card", icon: CreditCard },
];

let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

export function BillComposer({ services, currencySymbol }: { services: ServiceDTO[]; currencySymbol: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("CASH");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [customService, setCustomService] = useState<{ name: string; price: string } | null>(null);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => sum + toPaise(l.unitPrice) * l.quantity, 0);
    const disc = Math.max(0, toPaise(discount));
    return { subtotal, discount: disc, total: Math.max(0, subtotal - disc), discountTooBig: disc > subtotal };
  }, [lines, discount]);

  const addProduct = (p: ProductDTO) => {
    if (p.quantity <= 0) {
      toast.error(`${p.name} is out of stock.`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.kind === "PRODUCT" && l.productId === p.id);
      if (existing) {
        if (existing.quantity >= p.quantity) {
          toast.error(`Only ${p.quantity} of ${p.name} in stock.`);
          return prev;
        }
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          key: nextKey(),
          kind: "PRODUCT",
          productId: p.id,
          name: p.name,
          quantity: 1,
          unitPrice: p.sellingPrice ? trimMoney(p.sellingPrice) : "",
          available: p.quantity,
        },
      ];
    });
  };

  const addService = (s: ServiceDTO) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.kind === "SERVICE" && l.serviceId === s.id);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: nextKey(), kind: "SERVICE", serviceId: s.id, name: s.name, quantity: 1, unitPrice: trimMoney(s.price) }];
    });
  };

  const addCustomService = () => {
    if (!customService) return;
    const name = customService.name.trim();
    if (!name) return;
    setLines((prev) => [...prev, { key: nextKey(), kind: "SERVICE", serviceId: null, name, quantity: 1, unitPrice: customService.price }]);
    setCustomService(null);
  };

  const update = (key: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const submit = () => {
    setErrors({});
    setFormError(null);
    if (!lines.length) return setFormError("Add at least one product or service.");
    for (const l of lines) {
      if (l.unitPrice.trim() === "") return setFormError(`Enter a price for "${l.name}".`);
      if (l.kind === "PRODUCT" && l.available !== undefined && l.quantity > l.available) {
        return setFormError(`Only ${l.available} of "${l.name}" in stock.`);
      }
    }
    if (totals.discountTooBig) return setFormError("Discount cannot be more than the subtotal.");
    start(async () => {
      const res = await createBillAction({
        items: lines.map((l) =>
          l.kind === "PRODUCT"
            ? { kind: "PRODUCT", productId: l.productId!, quantity: l.quantity, unitPrice: l.unitPrice }
            : { kind: "SERVICE", serviceId: l.serviceId ?? undefined, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice },
        ),
        customerName,
        customerPhone,
        discount,
        paymentMethod: payment,
        notes,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(`${res.data.billNumber} saved`, { description: `Total ${formatMoney(res.data.total, currencySymbol)}. Stock updated.` });
      router.push(`/billing/${res.data.id}?new=1`);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:items-start">
      {/* Left: add items */}
      <div className="space-y-5 lg:col-span-3">
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="font-heading text-lg">Products</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Scan a barcode or search by name. Enter adds the first match.</p>
          <ProductSearch onPick={addProduct} currencySymbol={currencySymbol} />
        </section>

        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="flex items-center gap-2 font-heading text-lg">
            <Scissors className="size-4.5 text-primary" /> Services
          </h2>
          {services.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {services.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => addService(s)}
                    className="flex min-h-11 items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent active:translate-y-px"
                  >
                    <Plus className="size-4 text-muted-foreground" />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">{formatMoney(s.price, currencySymbol)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No saved services yet. The owner can add them in Settings, or add a one-off service below.</p>
          )}
          {customService ? (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row sm:items-end">
              <Field label="Service name" htmlFor="custom-service-name" className="flex-1">
                <Input
                  id="custom-service-name"
                  autoFocus
                  className="h-11"
                  value={customService.name}
                  onChange={(e) => setCustomService({ ...customService, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomService())}
                  placeholder="e.g. Hair wash"
                  maxLength={120}
                />
              </Field>
              <Field label="Price" htmlFor="custom-service-price" className="sm:w-36">
                <Input
                  id="custom-service-price"
                  className="h-11"
                  inputMode="decimal"
                  value={customService.price}
                  onChange={(e) => setCustomService({ ...customService, price: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomService())}
                  placeholder="0"
                />
              </Field>
              <div className="flex gap-2">
                <Button type="button" size="lg" className="h-11" onClick={addCustomService} disabled={!customService.name.trim() || customService.price.trim() === ""}>
                  Add
                </Button>
                <Button type="button" size="lg" variant="ghost" className="h-11" onClick={() => setCustomService(null)} aria-label="Cancel">
                  <X />
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" size="lg" className="mt-3 h-11" onClick={() => setCustomService({ name: "", price: "" })}>
              <Plus /> One-off service
            </Button>
          )}
        </section>
      </div>

      {/* Right: the bill */}
      <section className="rounded-2xl border bg-card shadow-xs lg:sticky lg:top-6 lg:col-span-2">
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 font-heading text-lg">
            <Receipt className="size-4.5 text-primary" /> Bill
          </h2>
          <span className="text-sm text-muted-foreground">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing added yet. Scan or search a product, or tap a service.</p>
        ) : (
          <ul className="divide-y">
            {lines.map((l) => {
              const lineTotal = toPaise(l.unitPrice) * l.quantity;
              const over = l.kind === "PRODUCT" && l.available !== undefined && l.quantity > l.available;
              return (
                <li key={l.key} className="space-y-2 px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.kind === "SERVICE" ? "Service" : l.available !== undefined ? `${l.available} in stock` : "Product"}
                      </p>
                    </div>
                    <button type="button" onClick={() => remove(l.key)} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Remove ${l.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-xl border">
                      <button type="button" className="flex size-10 items-center justify-center rounded-l-xl hover:bg-muted disabled:opacity-40" onClick={() => update(l.key, { quantity: Math.max(1, l.quantity - 1) })} disabled={l.quantity <= 1} aria-label="Decrease">
                        <Minus className="size-4" />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => update(l.key, { quantity: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1) })}
                        className={cn("h-10 w-12 border-x bg-background text-center text-base font-semibold tabular-nums outline-none", over && "text-destructive")}
                        aria-label="Quantity"
                      />
                      <button
                        type="button"
                        className="flex size-10 items-center justify-center rounded-r-xl hover:bg-muted disabled:opacity-40"
                        onClick={() => update(l.key, { quantity: l.quantity + 1 })}
                        disabled={l.kind === "PRODUCT" && l.available !== undefined && l.quantity >= l.available}
                        aria-label="Increase"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                      <Input
                        inputMode="decimal"
                        value={l.unitPrice}
                        onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                        className="h-10 pl-7 text-right tabular-nums"
                        placeholder="Price"
                        aria-label={`Unit price for ${l.name}`}
                      />
                    </div>
                    <p className="w-24 shrink-0 text-right font-semibold tabular-nums">{formatMoney(fromPaise(lineTotal), currencySymbol)}</p>
                  </div>
                  {over ? <p className="text-xs text-destructive">Only {l.available} in stock.</p> : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-4 border-t px-4 py-4 sm:px-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer name" htmlFor="bill-customer" error={errors.customerName}>
              <Input id="bill-customer" className="h-11" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" maxLength={120} />
            </Field>
            <Field label="Phone" htmlFor="bill-phone" error={errors.customerPhone}>
              <Input id="bill-phone" className="h-11" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Optional" maxLength={20} aria-invalid={Boolean(errors.customerPhone)} />
            </Field>
          </div>

          <Field label="Payment method" htmlFor="bill-payment">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" id="bill-payment">
              {PAYMENTS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={payment === p.value}
                  onClick={() => setPayment(p.value)}
                  className={cn(
                    "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors",
                    payment === p.value ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-accent",
                  )}
                >
                  <p.icon className="size-4" /> {p.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatMoney(fromPaise(totals.subtotal), currencySymbol)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="bill-discount" className="text-muted-foreground">
                Discount
              </label>
              <div className="relative w-32">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{currencySymbol}</span>
                <Input id="bill-discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} className={cn("h-9 pl-7 text-right tabular-nums", totals.discountTooBig && "border-destructive")} placeholder="0" />
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-2 text-base">
              <span className="font-semibold">Total</span>
              <span className="text-2xl font-semibold tabular-nums">{formatMoney(fromPaise(totals.total), currencySymbol)}</span>
            </div>
          </div>

          <Field label="Notes" htmlFor="bill-notes">
            <Input id="bill-notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" maxLength={500} />
          </Field>

          {formError ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <Button type="button" size="lg" className="h-12 w-full text-base" onClick={submit} disabled={pending || lines.length === 0}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Receipt />} Complete bill · {formatMoney(fromPaise(totals.total), currencySymbol)}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProductSearch({ onPick, currencySymbol }: { onPick: (p: ProductDTO) => void; currencySymbol: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cancel any in-flight debounce when the component unmounts.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    if (!value.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const res = await quickSearchProductsAction(value);
      if (seq.current !== id) return;
      setResults(res.ok ? res.data : []);
      setLoading(false);
    }, 180);
  };

  const pick = (p: ProductDTO) => {
    onPick(p);
    onQueryChange("");
    inputRef.current?.focus();
  };

  const onEnter = async () => {
    const code = query.trim();
    if (!code) return;
    // USB scanners type the code then press Enter: try an exact match first.
    const exact = await lookupProductByCodeAction(code);
    if (exact.ok && exact.data) return pick(exact.data);
    if (results.length) return pick(results[0]);
    toast.error(`No product matches "${code}".`);
  };

  return (
    <div className="mt-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onEnter();
            }
          }}
          placeholder="Scan barcode or search name, SKU..."
          className="h-12 pl-9 text-base"
          autoComplete="off"
        />
        {loading ? <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
      </div>
      {query.trim() && !loading ? (
        <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-xl border">
          {results.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">No products match “{query}”.</li>
          ) : (
            results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={p.quantity === 0}
                  onClick={() => pick(p)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.categoryName} · {formatMoney(p.sellingPrice, currencySymbol)}
                      {p.barcode ? ` · ${p.barcode}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{p.quantity}</p>
                    <StockBadge status={p.stockStatus} />
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
