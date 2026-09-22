"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { quickSearchProductsAction } from "@/app/actions/products";
import type { ActionResult } from "@/lib/errors";
import type { ProductDTO } from "@/lib/services/products";
import { formatMoney } from "@/lib/format";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StockBadge } from "@/components/app/stock-badge";

type PickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  currencySymbol: string;
  onPick: (product: ProductDTO) => void;
  disableOutOfStock?: boolean;
  /** Where results come from; defaults to the general product search. */
  search?: (query: string) => Promise<ActionResult<ProductDTO[]>>;
};

/**
 * "Which product?" picker used by the dashboard quick actions (Add Stock / Record Sale).
 * Searches by name, SKU or barcode as you type. State lives in PickerBody, which
 * mounts fresh every time the dialog opens.
 */
export function ProductPickerDialog({ open, onOpenChange, title, description, ...rest }: PickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? <PickerBody {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ currencySymbol, onPick, disableOutOfStock, search = quickSearchProductsAction }: Pick<PickerProps, "currencySymbol" | "onPick" | "disableOutOfStock" | "search">) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductDTO[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const res = await search(query);
      if (seq.current !== id) return;
      setResults(res.ok ? res.data : []);
    }, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, search]);

  const loading = results === null;

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results && results.length > 0) {
              e.preventDefault();
              const exact = results.find((r) => r.barcode === query.trim()) ?? results[0];
              if (!(disableOutOfStock && exact.quantity === 0)) onPick(exact);
            }
          }}
          placeholder="Search product name, SKU or barcode..."
          className="h-11 pl-9 text-base"
          autoComplete="off"
        />
      </div>
      <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
        {loading ? (
          <li className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Searching…
          </li>
        ) : results.length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">No products match “{query}”.</li>
        ) : (
          results.map((p) => {
            const disabled = Boolean(disableOutOfStock && p.quantity === 0);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.categoryName} · {formatMoney(p.sellingPrice, currencySymbol)}
                      {p.barcode ? ` · ${p.barcode}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{p.quantity}</p>
                    <StockBadge status={p.stockStatus} />
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
