"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/app/native-select";

export function Pagination({ page, pageCount, total, pageSize }: { page: number; pageCount: number; total: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Nothing to page through or resize when everything fits in the smallest page.
  if (total <= PAGE_SIZE_OPTIONS[0]) return null;

  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`, { scroll: true });
  };

  const resize = (size: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("size", String(size));
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // A page whose default size is not one of the options (e.g. 30) still shows it as selected.
  const sizes = PAGE_SIZE_OPTIONS.includes(pageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? [...PAGE_SIZE_OPTIONS] : [...PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {from}–{to} of {total}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">Rows per page</span>
          <NativeSelect className="h-9 w-20" value={pageSize} onChange={(e) => resize(Number(e.target.value))} aria-label="Rows per page">
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="lg" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button variant="outline" size="lg" onClick={() => go(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <span className="hidden sm:inline">Next</span> <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
