"use client";

import { PackageSearch } from "lucide-react";
import Link from "next/link";
import type { ProductDTO } from "@/lib/services/products";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/app/product-card";
import { ProductTable } from "@/components/app/product-table";
import { useStockDialogs } from "@/components/app/stock-dialogs";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";

/**
 * Renders products as cards on phones and as a table on wider screens,
 * sharing one set of Sell / Add Stock / Adjust dialogs.
 */
export function ProductList({
  products,
  currencySymbol,
  total,
  page,
  pageCount,
  pageSize,
  emptyTitle = "No products found",
  emptyDescription = "Try a different search or clear the filters.",
  highlightId,
}: {
  products: ProductDTO[];
  currencySymbol: string;
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  emptyTitle?: string;
  emptyDescription?: string;
  highlightId?: string | null;
}) {
  const { openDialog, dialogs } = useStockDialogs();

  if (products.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Button render={<Link href="/inventory/new" />} size="lg">
            Add a product
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} currencySymbol={currencySymbol} onAction={openDialog} highlight={highlightId === p.id} />
        ))}
      </div>
      <div className="hidden lg:block">
        <ProductTable products={products} currencySymbol={currencySymbol} onAction={openDialog} highlightId={highlightId} />
      </div>
      <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} />
      {dialogs}
    </>
  );
}
