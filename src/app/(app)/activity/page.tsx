import type { Metadata } from "next";
import { Suspense } from "react";
import { Activity } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { listMovements } from "@/lib/services/inventory";
import { parsePaging } from "@/lib/paging";
import type { MovementType } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/app/page-header";
import { MovementList } from "@/components/app/movement-list";
import { Pagination } from "@/components/app/pagination";
import { EmptyState } from "@/components/app/empty-state";
import { ActivityFilter } from "@/components/app/activity-filter";
import { DownloadExcelButton } from "@/components/app/download-excel-button";

export const metadata: Metadata = { title: "Stock Activity" };

const TYPES = new Set<MovementType>(["INITIAL_STOCK", "STOCK_IN", "SALE", "ADJUSTMENT", "BILL_CANCELLED", "BILL_EDITED"]);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string; size?: string }> }) {
  await requirePermissionPage("stock.history.view");
  const params = await searchParams;
  const type = TYPES.has(params.type as MovementType) ? (params.type as MovementType) : undefined;
  const result = await listMovements({ type, ...parsePaging(params) });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock Activity"
        description="Every change to stock, who made it and when. Records here are permanent."
        actions={
          <>
            <DownloadExcelButton kind="stock-activity" />
            <Suspense>
              <ActivityFilter />
            </Suspense>
          </>
        }
      />
      {result.items.length ? (
        <>
          <MovementList movements={result.items} />
          <Suspense>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
          </Suspense>
        </>
      ) : (
        <EmptyState icon={Activity} title="No stock activity yet" description="Sales, deliveries and adjustments will appear here." />
      )}
    </div>
  );
}
