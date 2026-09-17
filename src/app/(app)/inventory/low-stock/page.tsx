import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listCategories, listProducts, productsForViewer } from "@/lib/services/products";
import { PageHeader } from "@/components/app/page-header";
import { ProductFilters } from "@/components/app/product-filters";
import { ProductList } from "@/components/app/product-list";

export const metadata: Metadata = { title: "Low Stock" };
export const dynamic = "force-dynamic";

export default async function LowStockPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requireUserPage();
  const params = await searchParams;
  const [settings, categories, result] = await Promise.all([
    getSettings(),
    listCategories(),
    listProducts({ search: params.q, stockStatus: "LOW_STOCK", sort: "quantity", page: Number(params.page) || 1 }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Low Stock"
        description={`${result.total} product${result.total === 1 ? "" : "s"} with ${settings.lowStockThreshold} or fewer units. Consider reordering these.`}
      />
      <Suspense>
        <ProductFilters categories={categories} showFilters={false} />
      </Suspense>
      <ProductList
        products={productsForViewer(result.items, user.role)}
        currencySymbol={settings.currencySymbol}
        total={result.total}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        emptyTitle="Nothing is running low"
        emptyDescription={`No active product has between 1 and ${settings.lowStockThreshold} units.`}
      />
    </div>
  );
}
