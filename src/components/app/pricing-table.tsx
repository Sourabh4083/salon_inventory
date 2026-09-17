"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle, Pencil, Save, Tags } from "lucide-react";
import { updateProductPricesAction } from "@/app/actions/products";
import type { ProductDTO } from "@/lib/services/products";
import { computeMargin, trimMoney } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";

function MarginCell({ product, currencySymbol, compact }: { product: ProductDTO; currencySymbol: string; compact?: boolean }) {
  const m = computeMargin(product.costPrice, product.sellingPrice);
  if (m.profit == null) return <span className="text-muted-foreground">—</span>;
  const negative = Number(m.profit) < 0;
  return (
    <span className={cn("tabular-nums", negative ? "font-semibold text-destructive" : "text-emerald-700 dark:text-emerald-300")}>
      {formatMoney(m.profit, currencySymbol)}
      {m.marginPct != null ? <span className={cn("ml-1 text-xs", compact ? "" : "text-muted-foreground")}>({m.marginPct}%)</span> : null}
    </span>
  );
}

function isBelowCost(p: ProductDTO) {
  const m = computeMargin(p.costPrice, p.sellingPrice);
  return m.profit != null && Number(m.profit) < 0;
}

export function PricingTable({ products, currencySymbol, emptyQuery }: { products: ProductDTO[]; currencySymbol: string; emptyQuery?: string }) {
  const [editing, setEditing] = useState<ProductDTO | null>(null);

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Tags}
        title={emptyQuery ? `No products match “${emptyQuery}”` : "No products yet"}
        description={emptyQuery ? "Check the spelling or clear the search." : "Add products to see their prices and margins here."}
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <ul className="space-y-3 lg:hidden">
        {products.map((p) => (
          <li key={p.id} className={cn("rounded-2xl border bg-card p-4 shadow-xs", isBelowCost(p) && "border-destructive/40 bg-destructive/5")}>
            <div className="flex items-start justify-between gap-3">
              <Link href={`/inventory/${p.id}`} className="min-w-0">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.categoryName} · {p.quantity} in stock
                </p>
              </Link>
              <Button size="sm" variant="outline" className="h-9" onClick={() => setEditing(p)} aria-label={`Edit prices for ${p.name}`}>
                <Pencil /> Edit
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Cost</dt>
                <dd className="font-medium tabular-nums">{formatMoney(p.costPrice, currencySymbol)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Selling</dt>
                <dd className="font-medium tabular-nums">{formatMoney(p.sellingPrice, currencySymbol)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Profit</dt>
                <dd className="font-medium">
                  <MarginCell product={p} currencySymbol={currencySymbol} compact />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-xs lg:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Cost price</TableHead>
                <TableHead className="text-right">Selling price</TableHead>
                <TableHead className="text-right">Profit / unit (margin)</TableHead>
                <TableHead className="text-right">Stock value at cost</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const below = isBelowCost(p);
                const missing = p.costPrice == null || p.sellingPrice == null;
                return (
                  <TableRow key={p.id} className={cn(below && "bg-destructive/5 hover:bg-destructive/10")}>
                    <TableCell className="pl-4">
                      <Link href={`/inventory/${p.id}`} className="block max-w-[300px]">
                        <span className="block truncate font-medium text-foreground hover:text-primary">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{p.productNumber}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{p.categoryName}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(p.costPrice, currencySymbol)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(p.sellingPrice, currencySymbol)}</TableCell>
                    <TableCell className="text-right">
                      <MarginCell product={p} currencySymbol={currencySymbol} />
                      {below ? <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive uppercase">Below cost</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.costPrice != null ? formatMoney(String(Number(p.costPrice) * Math.max(0, p.quantity)), currencySymbol) : "—"}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button size="sm" variant={missing ? "default" : "outline"} onClick={() => setEditing(p)} aria-label={`Edit prices for ${p.name}`}>
                        <Pencil /> {missing ? "Set prices" : "Edit prices"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <EditPricesDialog product={editing} currencySymbol={currencySymbol} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}

function EditPricesDialog({ product, currencySymbol, onOpenChange }: { product: ProductDTO | null; currencySymbol: string; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Edit prices</DialogTitle>
          <DialogDescription>{product ? `${product.name} · ${product.productNumber}` : ""}</DialogDescription>
        </DialogHeader>
        {product ? <EditPricesForm key={product.id} product={product} currencySymbol={currencySymbol} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditPricesForm({ product, currencySymbol, close }: { product: ProductDTO; currencySymbol: string; close: () => void }) {
  const router = useRouter();
  const [cost, setCost] = useState(product.costPrice ? trimMoney(product.costPrice) : "");
  const [selling, setSelling] = useState(product.sellingPrice ? trimMoney(product.sellingPrice) : "");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = computeMargin(cost || null, selling || null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErr({});
    setError(null);
    start(async () => {
      const res = await updateProductPricesAction(product.id, { costPrice: cost, sellingPrice: selling });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Prices updated", {
        description: `${res.data.name} · cost ${formatMoney(res.data.costPrice, currencySymbol)} · selling ${formatMoney(res.data.sellingPrice, currencySymbol)}`,
      });
      close();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Cost price (${currencySymbol})`} htmlFor="edit-cost" error={fieldErr.costPrice}>
          <Input id="edit-cost" className="h-11 text-base" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 450" autoFocus aria-invalid={Boolean(fieldErr.costPrice)} />
        </Field>
        <Field label={`Selling price (${currencySymbol})`} htmlFor="edit-selling" error={fieldErr.sellingPrice}>
          <Input id="edit-selling" className="h-11 text-base" inputMode="decimal" value={selling} onChange={(e) => setSelling(e.target.value)} placeholder="e.g. 600" aria-invalid={Boolean(fieldErr.sellingPrice)} />
        </Field>
      </div>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        Profit per unit:{" "}
        {preview.profit != null ? (
          <span className={cn("font-semibold tabular-nums", Number(preview.profit) < 0 ? "text-destructive" : "text-emerald-700")}>
            {formatMoney(preview.profit, currencySymbol)}
            {preview.marginPct != null ? ` (${preview.marginPct}% margin, ${preview.markupPct ?? "—"}% markup)` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">enter both prices</span>
        )}
      </p>
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save prices
        </Button>
      </DialogFooter>
    </form>
  );
}
