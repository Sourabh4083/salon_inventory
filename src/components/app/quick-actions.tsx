"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, PackagePlus, Receipt, ScanBarcode } from "lucide-react";
import type { ProductDTO } from "@/lib/services/products";
import { ProductPickerDialog } from "@/components/app/product-picker-dialog";
import { StockInDialog } from "@/components/app/stock-dialogs";

type Step = { kind: "stockIn"; product: ProductDTO | null } | null;

const tile =
  "flex min-h-[4.5rem] items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0";

export function QuickActions({ currencySymbol }: { currencySymbol: string }) {
  const [step, setStep] = useState<Step>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/inventory/new" className={tile}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <PackagePlus className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Add Product</span>
            <span className="block text-xs text-muted-foreground">New item in shop</span>
          </span>
        </Link>
        <button type="button" className={tile} onClick={() => setStep({ kind: "stockIn", product: null })}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <ArrowDownToLine className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Add Stock</span>
            <span className="block text-xs text-muted-foreground">Material arrived</span>
          </span>
        </button>
        <Link href="/billing/new" className={tile}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
            <Receipt className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">New Bill</span>
            <span className="block text-xs text-muted-foreground">Bill a customer</span>
          </span>
        </Link>
        <Link href="/scan" className={tile}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <ScanBarcode className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">Scan Barcode</span>
            <span className="block text-xs text-muted-foreground">Camera or USB</span>
          </span>
        </Link>
      </div>

      <ProductPickerDialog
        open={step !== null && step.product === null}
        onOpenChange={(o) => !o && setStep(null)}
        title="Add stock"
        description="Which product arrived?"
        currencySymbol={currencySymbol}
        onPick={(product) => setStep((s) => (s ? { ...s, product } : s))}
      />
      <StockInDialog product={step?.kind === "stockIn" ? step.product : null} open={step?.kind === "stockIn" && step.product !== null} onOpenChange={(o) => !o && setStep(null)} />
    </>
  );
}
