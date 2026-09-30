import type { Metadata } from "next";
import { parsePaging } from "@/lib/paging";
import Link from "next/link";
import { Suspense } from "react";
import { Archive, PackagePlus } from "lucide-react";
import { requireUserPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listCategories, listProducts, productsForViewer, type ProductSort } from "@/lib/services/products";
import type { StockStatus } from "@/lib/stock-status";
import { PageHeader } from "@/components/app/page-header";
import { ProductFilters } from "@/components/app/product-filters";
import { ProductList } from "@/components/app/product-list";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "All Products" };

type Params = { q?: string; category?: string; status?: string; sort?: string; page?: string; size?: string; archived?: string };

const STATUSES = new Set<StockStatus>(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]);
const SORTS = new Set<ProductSort>(["name", "quantity", "price", "updated"]);

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUserPage();
  const params = await searchParams;
  const showArchived = params.archived === "1" && user.role === "OWNER";
  const stockStatus = STATUSES.has(params.status as StockStatus) ? (params.status as StockStatus) : undefined;
  const sort = SORTS.has(params.sort as ProductSort) ? (params.sort as ProductSort) : "name";

  const [settings, categories, result] = await Promise.all([
    getSettings(),
    listCategories(),
    listProducts({
      search: params.q,
      categoryId: params.category || undefined,
      stockStatus: showArchived ? undefined : stockStatus,
      sort,
      ...parsePaging(params),
      archivedOnly: showArchived,
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={showArchived ? "Archived Products" : "All Products"}
        description={
          showArchived
            ? "Archived items are hidden from daily use but keep their full stock history."
            : `${result.total} product${result.total === 1 ? "" : "s"}${params.q ? ` matching “${params.q}”` : ""}`
        }
        actions={
          <>
            {can(user.role, "data.export") ? <DownloadExcelButton kind="products" /> : null}
            {user.role === "OWNER" ? (
              <Button variant="outline" size="lg" className="h-11" render={<Link href={showArchived ? "/inventory" : "/inventory?archived=1"} />}>
                <Archive /> {showArchived ? "Active products" : "Archived"}
              </Button>
            ) : null}
            <Button size="lg" className="h-11" render={<Link href="/inventory/new" />}>
              <PackagePlus /> Add Product
            </Button>
          </>
        }
      />
      <Suspense>
        <ProductFilters categories={categories} showFilters={!showArchived} />
      </Suspense>
      <ProductList
        products={productsForViewer(result.items, user.role)}
        currencySymbol={settings.currencySymbol}
        total={result.total}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        emptyTitle={showArchived ? "No archived products" : params.q ? `No products match “${params.q}”` : "No products yet"}
        emptyDescription={
          showArchived
            ? "Products you archive will appear here."
            : params.q
              ? "Check the spelling, or add it as a new product."
              : "Add your first product to start tracking stock."
        }
      />
    </div>
  );
}
