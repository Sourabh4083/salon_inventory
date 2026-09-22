import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive, History, Truck } from "lucide-react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getProduct, movementsForViewer, productForViewer } from "@/lib/services/products";
import { can } from "@/lib/permissions";
import { computeMargin } from "@/lib/money";
import { listMovements } from "@/lib/services/inventory";
import { getPendingOrdersForProduct } from "@/lib/services/orders";
import { formatDateTime, formatMoney } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/constants";
import { StockBadge } from "@/components/app/stock-badge";
import { MovementList } from "@/components/app/movement-list";
import { ProductDetailActions } from "@/components/app/product-detail-actions";
import { Pagination } from "@/components/app/pagination";
import { Suspense } from "react";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product?.name ?? "Product" };
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; from?: string }>;
}) {
  const user = await requireUserPage();
  const [{ id }, { page, from }] = await Promise.all([params, searchParams]);
  const showCost = can(user.role, "product.cost.view");
  const showHistory = can(user.role, "stock.history.view");
  const [settings, found, history, onOrder] = await Promise.all([
    getSettings(),
    getProduct(id),
    showHistory ? listMovements({ productId: id, page: Number(page) || 1, pageSize: 20 }) : null,
    can(user.role, "order.view") ? getPendingOrdersForProduct(id) : [],
  ]);
  if (!found) notFound();
  const product = productForViewer(found, user.role);
  const margin = showCost ? computeMargin(product.costPrice, product.sellingPrice) : null;

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Product no.", value: <span className="font-mono">{product.productNumber}</span> },
    { label: "SKU", value: product.sku ? <span className="font-mono">{product.sku}</span> : "—" },
    { label: "Barcode", value: product.barcode ? <span className="font-mono">{product.barcode}</span> : "—" },
    { label: "Category", value: product.categoryName },
    { label: "Unit", value: UNIT_LABEL[product.unit] },
    { label: "Location", value: product.location ?? "—" },
    ...(showCost
      ? [
          { label: "Cost price", value: formatMoney(product.costPrice, settings.currencySymbol) },
          {
            label: "Profit per unit",
            value:
              margin?.profit != null ? (
                <span className={Number(margin.profit) < 0 ? "text-destructive" : undefined}>
                  {formatMoney(margin.profit, settings.currencySymbol)}
                  {margin.marginPct != null ? ` (${margin.marginPct}% margin)` : ""}
                </span>
              ) : (
                "—"
              ),
          },
        ]
      : []),
    { label: "Low stock at", value: `${product.effectiveThreshold} ${product.lowStockThreshold == null ? "(shop default)" : "(custom)"}` },
  ];

  return (
    <div className="space-y-6">
      <Link href="/inventory" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All products
      </Link>

      {from === "scan" ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">Barcode matched this product.</p>
      ) : null}

      <div className={showHistory ? "grid grid-cols-1 gap-6 lg:grid-cols-3" : "mx-auto max-w-4xl"}>
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-heading text-2xl leading-tight sm:text-3xl">{product.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {product.categoryName} · {product.productNumber}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {product.status === "ARCHIVED" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground uppercase">
                    <Archive className="size-3" /> Archived
                  </span>
                ) : null}
                <StockBadge status={product.stockStatus} size="md" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">Current quantity</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">
                  {product.quantity} <span className="text-sm font-normal text-muted-foreground">{UNIT_LABEL[product.unit].toLowerCase()}</span>
                </p>
              </div>
              <div className="rounded-xl bg-muted/50 p-4">
                <p className="text-xs text-muted-foreground">Selling price</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(product.sellingPrice, settings.currencySymbol)}</p>
              </div>
              <div className="col-span-2 rounded-xl bg-muted/50 p-4 sm:col-span-1">
                <p className="text-xs text-muted-foreground">Last updated</p>
                <p className="mt-1 font-medium">{formatDateTime(product.updatedAt)}</p>
                <p className="text-xs text-muted-foreground">by {product.updatedByName ?? "—"}</p>
              </div>
            </div>

            {onOrder.length ? (
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                <Truck className="size-4 shrink-0" />
                On order: {onOrder.reduce((n, o) => n + o.pending, 0)} pending
                <span className="text-sky-800/80 dark:text-sky-200/80">
                  (
                  {onOrder.map((o, i) => (
                    <span key={o.orderId}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/orders/${o.orderId}`} className="font-medium underline-offset-2 hover:underline">
                        {o.orderNumber}
                      </Link>
                    </span>
                  ))}
                  )
                </span>
              </p>
            ) : null}

            <div className="mt-5">
              <ProductDetailActions product={product} role={user.role} />
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
            <h2 className="font-heading text-lg">Details</h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-4 border-b border-dashed pb-2 sm:block sm:border-0 sm:pb-0">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right font-medium break-all sm:mt-0.5 sm:text-left">{f.value}</dd>
                </div>
              ))}
            </dl>
            {product.description ? (
              <div className="mt-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Description</p>
                <p className="mt-1 text-sm whitespace-pre-line">{product.description}</p>
              </div>
            ) : null}
            {product.notes ? (
              <div className="mt-4">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notes</p>
                <p className="mt-1 text-sm whitespace-pre-line">{product.notes}</p>
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              Created {formatDateTime(product.createdAt)}
              {product.createdByName ? ` by ${product.createdByName}` : ""}
            </p>
          </section>
        </div>

        {history ? (
          <section className="space-y-3 lg:col-span-1" aria-labelledby="history-heading">
            <h2 id="history-heading" className="flex items-center gap-2 font-heading text-lg">
              <History className="size-4.5 text-primary" /> Stock history
              <span className="text-sm font-normal text-muted-foreground">({history.total})</span>
            </h2>
            {history.items.length ? (
              <>
                <MovementList movements={movementsForViewer(history.items, user.role)} showProduct={false} />
                <Suspense>
                  <Pagination page={history.page} pageCount={history.pageCount} total={history.total} pageSize={history.pageSize} />
                </Suspense>
              </>
            ) : (
              <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No stock movements yet.</p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
