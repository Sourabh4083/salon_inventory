"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({ page, pageCount, total, pageSize }: { page: number; pageCount: number; total: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (pageCount <= 1) return null;

  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`, { scroll: true });
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 pt-4">
      <p className="text-sm text-muted-foreground">
        {from}–{to} of {total}
      </p>
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
    </div>
  );
}
