"use client";

import Link from "next/link";
import { ArrowDownToLine, ClipboardCheck, MoreHorizontal, PackageMinus, Pencil } from "lucide-react";
import type { ProductDTO } from "@/lib/services/products";
import { formatMoney, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useCan } from "@/components/app/role-context";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StockBadge } from "@/components/app/stock-badge";
import type { StockDialogKind } from "@/components/app/stock-dialogs";

export function ProductTable({
  products,
  currencySymbol,
  onAction,
  highlightId,
}: {
  products: ProductDTO[];
  currencySymbol: string;
  onAction: (kind: StockDialogKind, product: ProductDTO) => void;
  highlightId?: string | null;
}) {
  const canAdjust = useCan("stock.adjust");
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-4">Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id} className={highlightId === p.id ? "bg-accent/60" : undefined}>
                <TableCell className="pl-4">
                  <Link href={`/inventory/${p.id}`} className="block max-w-[280px]">
                    <span className="block truncate font-medium text-foreground hover:text-primary">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.productNumber}</span>
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{p.barcode ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.categoryName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(p.sellingPrice, currencySymbol)}</TableCell>
                <TableCell className="text-right text-base font-semibold tabular-nums">{p.quantity}</TableCell>
                <TableCell>
                  <StockBadge status={p.stockStatus} />
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{formatRelative(p.updatedAt)}</TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onAction("sale", p)}
                      disabled={p.quantity === 0 || p.status === "ARCHIVED"}
                      title="Reduce stock without a bill"
                    >
                      <PackageMinus /> Reduce
                    </Button>
                    <Button size="sm"  onClick={() => onAction("stockIn", p)} disabled={p.status === "ARCHIVED"} title="Add stock">
                      <ArrowDownToLine /> Stock
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More actions" />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem render={<Link href={`/inventory/${p.id}`} />}>View details</DropdownMenuItem>
                        <DropdownMenuItem render={<Link href={`/inventory/${p.id}/edit`} />}>
                          <Pencil /> Edit product
                        </DropdownMenuItem>
                        {canAdjust ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onAction("adjust", p)} disabled={p.status === "ARCHIVED"}>
                              <ClipboardCheck /> Adjust stock
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
