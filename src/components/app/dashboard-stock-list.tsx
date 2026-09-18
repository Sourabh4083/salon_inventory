"use client";

import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import type { ProductDTO } from "@/lib/services/products";
import { Button } from "@/components/ui/button";
import { StockBadge } from "@/components/app/stock-badge";
import { useStockDialogs } from "@/components/app/stock-dialogs";

export function DashboardStockList({
  products,
  total,
  emptyText,
  kind,
}: {
  products: ProductDTO[];
  total: number;
  emptyText: string;
  kind: "low" | "out";
}) {
  const { openDialog, dialogs } = useStockDialogs();
  if (products.length === 0) {
    return <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <>
      <ul className="divide-y rounded-2xl border bg-card shadow-xs">
        {products.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/inventory/${p.id}`} className="block truncate font-medium hover:text-primary">
                {p.name}
              </Link>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{p.quantity} remaining</span>
                <StockBadge status={p.stockStatus} />
              </p>
            </div>
            <Button size="sm" variant={kind === "out" ? "default" : "secondary"} onClick={() => openDialog("stockIn", p)} aria-label={`Add stock for ${p.name}`}>
              <ArrowDownToLine /> <span className="hidden sm:inline">Add stock</span>
              <span className="sm:hidden">Stock</span>
            </Button>
          </li>
        ))}
        {total > products.length ? (
          <li className="px-4 py-2.5 text-center text-xs text-muted-foreground">
            <Link href={kind === "low" ? "/inventory/low-stock" : "/inventory/out-of-stock"} className="hover:text-primary">
              +{total - products.length} more
            </Link>
          </li>
        ) : null}
      </ul>
      {dialogs}
    </>
  );
}
