import type { Metadata } from "next";
import { parsePaging } from "@/lib/paging";
import { Suspense } from "react";
import { AlertTriangle, Boxes, Tags, TrendingUp } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getPricingSummary, listCategories, listProducts, type ProductSort } from "@/lib/services/products";
import { toPaise } from "@/lib/money";
import { formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { ProductFilters } from "@/components/app/product-filters";
import { PricingTable } from "@/components/app/pricing-table";
import { Pagination } from "@/components/app/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Prices & Margins" };

type Params = { q?: string; category?: string; sort?: string; page?: string; size?: string };
const SORTS = new Set<ProductSort>(["name", "quantity", "price", "updated"]);

export default async function PricingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePermissionPage("product.cost.view");
  const params = await searchParams;
  const sort = SORTS.has(params.sort as ProductSort) ? (params.sort as ProductSort) : "name";
  const [settings, categories, summary, result] = await Promise.all([
    getSettings(),
    listCategories(),
    getPricingSummary(),
    listProducts({ search: params.q, categoryId: params.category || undefined, sort, ...parsePaging(params) }),
  ]);
  const sym = settings.currencySymbol;
  const profitPositive = toPaise(summary.potentialProfit) >= 0;
  const attention = summary.missingCost + summary.missingSelling + summary.belowCost;

  const tiles = [
    { label: "Stock value at cost", value: formatMoney(summary.stockAtCost, sym), sub: `${formatNumber(summary.products)} active products`, icon: Boxes, tone: "text-sky-700 bg-sky-100" },
    { label: "Stock value at selling price", value: formatMoney(summary.stockAtSelling, sym), sub: "if everything sells at list price", icon: Tags, tone: "text-primary bg-primary/10" },
    {
      label: "Potential profit",
      value: formatMoney(summary.potentialProfit, sym),
      sub: "selling value minus cost value",
      icon: TrendingUp,
      tone: profitPositive ? "text-emerald-700 bg-emerald-100" : "text-red-700 bg-red-100",
    },
    {
      label: "Needs attention",
      value: formatNumber(attention),
      sub: `${summary.missingCost} no cost · ${summary.missingSelling} no price · ${summary.belowCost} below cost`,
      icon: AlertTriangle,
      tone: attention ? "text-amber-700 bg-amber-100" : "text-emerald-700 bg-emerald-100",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prices & Margins"
        description="Cost price, selling price and profit for every product. Only the owner can see this page."
      />

      <section aria-label="Pricing summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
            <span className={cn("flex size-9 items-center justify-center rounded-xl", t.tone)}>
              <t.icon className="size-4.5" />
            </span>
            <p className="mt-3 text-2xl font-semibold tabular-nums sm:text-3xl">{t.value}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.label}</p>
            <p className="text-xs text-muted-foreground">{t.sub}</p>
          </div>
        ))}
      </section>

      <Suspense>
        <ProductFilters categories={categories} showFilters="pricing" />
      </Suspense>

      <PricingTable products={result.items} currencySymbol={sym} emptyQuery={params.q} />
      <Suspense>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
      </Suspense>
    </div>
  );
}
