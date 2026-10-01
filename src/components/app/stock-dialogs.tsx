"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDownToLine, ClipboardCheck, LoaderCircle, PackageMinus } from "lucide-react";
import { adjustStockAction, saleAction, stockInAction } from "@/app/actions/inventory";
import type { ProductDTO } from "@/lib/services/products";
import { formatMoney } from "@/lib/format";
import { STOCK_STATUS_LABEL } from "@/lib/stock-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { QuantityStepper } from "@/components/app/quantity-stepper";
import { StockBadge } from "@/components/app/stock-badge";
import { useCan } from "@/components/app/role-context";

export type StockDialogKind = "sale" | "stockIn" | "adjust";

type BaseProps = {
  product: ProductDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (product: ProductDTO) => void;
};

type FormProps = { product: ProductDTO; close: () => void; onDone?: (product: ProductDTO) => void };

function ProductSummary({ product }: { product: ProductDTO }) {
  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            {product.productNumber} · {product.categoryName}
          </p>
        </div>
        <StockBadge status={product.stockStatus} />
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Available</p>
          <p className="text-2xl font-semibold tabular-nums">{product.quantity}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Selling price</p>
          <p className="font-medium">{formatMoney(product.sellingPrice)}</p>
        </div>
      </div>
    </div>
  );
}

function FooterButtons({ pending, disabled, close, icon, label }: { pending: boolean; disabled?: boolean; close: () => void; icon: React.ReactNode; label: string }) {
  return (
    <DialogFooter className="gap-2 sm:gap-2">
      <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={close} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending || disabled}>
        {pending ? <LoaderCircle className="animate-spin" /> : icon}
        {label}
      </Button>
    </DialogFooter>
  );
}

/* ---------------- REDUCE STOCK (no bill) ---------------- */

function ReduceStockForm({ product, close, onDone }: FormProps) {
  const id = useId();
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const n = Number.parseInt(qty, 10);
  const remaining = Number.isFinite(n) ? product.quantity - n : product.quantity;
  const tooMany = Number.isFinite(n) && n > product.quantity;
  const unavailableMsg = `Only ${product.quantity} ${product.quantity === 1 ? "unit is" : "units are"} currently available.`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(n) || n < 1) return setError("Enter a quantity of at least 1.");
    if (tooMany) return setError(unavailableMsg);
    start(async () => {
      const res = await saleAction({ productId: product.id, quantity: n, note });
      if (!res.ok) return setError(res.error);
      toast.success(`Reduced ${n} × ${product.name}`, {
        description: `Stock is now ${res.data.product.quantity} · ${STOCK_STATUS_LABEL[res.data.product.stockStatus]}`,
      });
      close();
      onDone?.(res.data.product);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ProductSummary product={product} />
      {product.quantity === 0 ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This product is out of stock. There is nothing left to reduce.
        </p>
      ) : (
        <>
          <Field label="Quantity to reduce" htmlFor={`${id}-qty`} error={error ?? undefined} required>
            <QuantityStepper id={`${id}-qty`} value={qty} onChange={(v) => { setQty(v); setError(null); }} min={1} max={product.quantity} autoFocus invalid={tooMany} />
            <p className={`text-xs ${tooMany ? "text-destructive" : "text-muted-foreground"}`}>
              {tooMany ? unavailableMsg : `${product.quantity} in stock → ${Math.max(0, remaining)} after this`}
            </p>
          </Field>
          <Field label="Note (optional)" htmlFor={`${id}-note`}>
            <Input id={`${id}-note`} className="h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. salon use, damaged, expired" maxLength={500} />
          </Field>
        </>
      )}
      <FooterButtons pending={pending} disabled={product.quantity === 0 || tooMany} close={close} icon={<PackageMinus />} label="Reduce stock" />
    </form>
  );
}

export function ReduceStockDialog({ product, open, onOpenChange, onDone }: BaseProps) {
  return (
    <Dialog open={open && product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-xl">
            <PackageMinus className="size-5 text-primary" /> Reduce stock
          </DialogTitle>
          <DialogDescription>
            Take stock out without a bill — salon use, damage or expiry. For a customer purchase, create a bill instead so the sale is counted.
          </DialogDescription>
        </DialogHeader>
        {product ? <ReduceStockForm key={product.id} product={product} close={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- ADD STOCK ---------------- */

function StockInForm({ product, close, onDone }: FormProps) {
  const id = useId();
  const [qty, setQty] = useState("1");
  const canSeeCost = useCan("product.cost.view");
  const [unitCost, setUnitCost] = useState(product.costPrice ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const n = Number.parseInt(qty, 10);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(n) || n < 1) return setError("Enter a quantity of at least 1.");
    start(async () => {
      const res = await stockInAction({ productId: product.id, quantity: n, unitCost: canSeeCost ? unitCost : "", note });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(`Added ${n} × ${product.name}`, {
        description: `Stock is now ${res.data.product.quantity} · ${STOCK_STATUS_LABEL[res.data.product.stockStatus]}`,
      });
      close();
      onDone?.(res.data.product);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ProductSummary product={product} />
      <Field label="Quantity received" htmlFor={`${id}-qty`} error={error ?? fieldErr.quantity} required>
        <QuantityStepper id={`${id}-qty`} value={qty} onChange={(v) => { setQty(v); setError(null); }} min={1} autoFocus />
        <p className="text-xs text-muted-foreground">
          {product.quantity} in stock → {product.quantity + (Number.isFinite(n) ? n : 0)} after delivery
        </p>
      </Field>
      <div className={`grid grid-cols-1 gap-4 ${canSeeCost ? "sm:grid-cols-2" : ""}`}>
        {canSeeCost ? (
          <Field label="Purchase price per unit (optional)" htmlFor={`${id}-cost`} error={fieldErr.unitCost}>
            <Input id={`${id}-cost`} className="h-10" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="e.g. 500" aria-invalid={Boolean(fieldErr.unitCost)} />
          </Field>
        ) : null}
        <Field label="Note (optional)" htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} className="h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. New delivery" maxLength={500} />
        </Field>
      </div>
      <FooterButtons pending={pending} close={close} icon={<ArrowDownToLine />} label="Confirm" />
    </form>
  );
}

export function StockInDialog({ product, open, onOpenChange, onDone }: BaseProps) {
  return (
    <Dialog open={open && product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-xl">
            <ArrowDownToLine className="size-5 text-primary" /> Add stock
          </DialogTitle>
          <DialogDescription>Record new material received. Stock is increased and logged in the history.</DialogDescription>
        </DialogHeader>
        {product ? <StockInForm key={product.id} product={product} close={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- ADJUST STOCK ---------------- */

function AdjustForm({ product, close, onDone }: FormProps) {
  const id = useId();
  const [qty, setQty] = useState(String(product.quantity));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const n = Number.parseInt(qty, 10);
  const diff = Number.isFinite(n) ? n - product.quantity : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(n) || n < 0) return setError("Enter the counted quantity (0 or more).");
    if (n === product.quantity) return setError("The new quantity is the same as the current stock.");
    if (!reason.trim()) return setFieldErr({ reason: "Please give a reason for the adjustment." });
    start(async () => {
      const res = await adjustStockAction({ productId: product.id, newQuantity: n, reason });
      if (!res.ok) {
        setFieldErr(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(`Adjusted ${product.name}`, {
        description: `${product.quantity} → ${res.data.product.quantity} (${diff > 0 ? "+" : ""}${diff})`,
      });
      close();
      onDone?.(res.data.product);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ProductSummary product={product} />
      <Field label="New physical quantity" htmlFor={`${id}-qty`} error={error ?? fieldErr.newQuantity} required>
        <QuantityStepper id={`${id}-qty`} value={qty} onChange={(v) => { setQty(v); setError(null); }} min={0} autoFocus />
        <p className={`text-xs ${diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
          System: {product.quantity} · Difference: {diff > 0 ? "+" : ""}{diff}
        </p>
      </Field>
      <Field label="Reason" htmlFor={`${id}-reason`} error={fieldErr.reason} required>
        <Textarea id={`${id}-reason`} value={reason} onChange={(e) => { setReason(e.target.value); setFieldErr({}); }} placeholder="e.g. Physical count correction, damaged item" rows={2} maxLength={500} aria-invalid={Boolean(fieldErr.reason)} />
      </Field>
      <FooterButtons pending={pending} close={close} icon={<ClipboardCheck />} label="Save adjustment" />
    </form>
  );
}

export function AdjustDialog({ product, open, onOpenChange, onDone }: BaseProps) {
  return (
    <Dialog open={open && product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-xl">
            <ClipboardCheck className="size-5 text-primary" /> Adjust stock
          </DialogTitle>
          <DialogDescription>Correct the system quantity to match a physical count. The difference is recorded.</DialogDescription>
        </DialogHeader>
        {product ? <AdjustForm key={product.id} product={product} close={() => onOpenChange(false)} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** One place holds the open dialog + product for a whole list. */
export function useStockDialogs() {
  const [state, setState] = useState<{ kind: StockDialogKind; product: ProductDTO } | null>(null);
  const openDialog = (kind: StockDialogKind, product: ProductDTO) => setState({ kind, product });
  const close = () => setState(null);
  const dialogs = (
    <>
      <ReduceStockDialog product={state?.kind === "sale" ? state.product : null} open={state?.kind === "sale"} onOpenChange={(o) => !o && close()} />
      <StockInDialog product={state?.kind === "stockIn" ? state.product : null} open={state?.kind === "stockIn"} onOpenChange={(o) => !o && close()} />
      <AdjustDialog product={state?.kind === "adjust" ? state.product : null} open={state?.kind === "adjust"} onOpenChange={(o) => !o && close()} />
    </>
  );
  return { openDialog, dialogs };
}
