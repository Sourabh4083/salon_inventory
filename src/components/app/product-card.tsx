"use client";

import Link from "next/link";
import { ArrowDownToLine, ChevronRight, ShoppingBag } from "lucide-react";
import type { ProductDTO } from "@/lib/services/products";
import { formatMoney, formatRelative } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { StockBadge } from "@/components/app/stock-badge";
import type { StockDialogKind } from "@/components/app/stock-dialogs";

export function ProductCard({
  product,
  currencySymbol,
  onAction,
  highlight,
}: {
  product: ProductDTO;
  currencySymbol: string;
  onAction: (kind: StockDialogKind, product: ProductDTO) => void;
  highlight?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-card p-4 shadow-xs transition-shadow ${highlight ? "ring-2 ring-primary/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/inventory/${product.id}`} className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-base leading-snug font-semibold text-foreground">{product.name}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {product.categoryName}
            {product.sku ? ` · SKU ${product.sku}` : ""}
            {product.barcode ? ` · ${product.barcode}` : ""}
          </p>
        </Link>
        <StockBadge status={product.stockStatus} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{formatMoney(product.sellingPrice, currencySymbol)}</p>
          <p className="text-xs text-muted-foreground">Updated {formatRelative(product.updatedAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Stock</p>
          <p className="text-2xl leading-none font-semibold tabular-nums">
            {product.quantity}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{UNIT_LABEL[product.unit].toLowerCase()}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="h-11"
          onClick={() => onAction("sale", product)}
          disabled={product.quantity === 0 || product.status === "ARCHIVED"}
        >
          <ShoppingBag /> Sell
        </Button>
        <Button size="lg" variant="secondary" className="h-11" onClick={() => onAction("stockIn", product)} disabled={product.status === "ARCHIVED"}>
          <ArrowDownToLine /> Stock
        </Button>
      </div>
      <Link
        href={`/inventory/${product.id}`}
        className="mt-2 flex min-h-10 items-center justify-center gap-1 rounded-lg text-sm font-medium text-primary hover:bg-accent"
      >
        View details <ChevronRight className="size-4" />
      </Link>
    </article>
  );
}
