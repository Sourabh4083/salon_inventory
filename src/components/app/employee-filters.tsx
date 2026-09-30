"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/app/native-select";

/** Search + active/inactive filter for the employees list. Updates the URL so results are server-rendered. */
export function EmployeeFilters({ showStatus = true }: { showStatus?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onQuery = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push((p) => (value.trim() ? p.set("q", value.trim()) : p.delete("q"))), 250);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search name, phone or designation..." className="h-11 pr-9 pl-9" autoComplete="off" aria-label="Search employees" />
        {pending ? (
          <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : query ? (
          <button type="button" onClick={() => onQuery("")} className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {showStatus ? (
        <NativeSelect className="h-11 sm:w-44" value={params.get("status") ?? "active"} onChange={(e) => push((p) => (e.target.value === "active" ? p.delete("status") : p.set("status", e.target.value)))} aria-label="Status">
          <option value="active">Working now</option>
          <option value="inactive">Left / inactive</option>
          <option value="all">Everyone</option>
        </NativeSelect>
      ) : null}
    </div>
  );
}
