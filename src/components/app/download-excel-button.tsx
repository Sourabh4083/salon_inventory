"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ExportKind = "products" | "bills" | "sales-report" | "expenses" | "salaries" | "stock-activity";

/**
 * Owner-only "Download Excel" link. It carries the page's current filters (search,
 * date range, ...) so the file matches what is on screen, minus the paging.
 * Pages render it only for the owner; the export route checks again.
 */
export function DownloadExcelButton({ kind, label = "Download Excel" }: { kind: ExportKind; label?: string }) {
  return (
    <Suspense fallback={<ExportLink kind={kind} label={label} query="" />}>
      <WithFilters kind={kind} label={label} />
    </Suspense>
  );
}

function WithFilters({ kind, label }: { kind: ExportKind; label: string }) {
  const params = new URLSearchParams(useSearchParams().toString());
  params.delete("page");
  params.delete("size");
  return <ExportLink kind={kind} label={label} query={params.toString()} />;
}

function ExportLink({ kind, label, query }: { kind: ExportKind; label: string; query: string }) {
  return (
    <Button variant="outline" size="lg" className="h-11" render={<a href={`/api/export/${kind}${query ? `?${query}` : ""}`} download />}>
      <FileSpreadsheet /> {label}
    </Button>
  );
}
