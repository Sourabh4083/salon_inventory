"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import type { RangeKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];

export function ReportRangePicker({ active, from, to, view }: { active: RangeKey; from: string; to: string; view?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState({ from, to });

  const go = (qs: string) => start(() => router.replace(`${pathname}?${qs}${view ? `&view=${view}` : ""}`, { scroll: false }));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={active === p.key}
            onClick={() => go(`range=${p.key}`)}
            className={cn(
              "h-10 rounded-xl px-3.5 text-sm font-medium transition-colors",
              active === p.key ? "bg-primary text-primary-foreground shadow-sm" : "bg-background hover:bg-accent",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.from && custom.to) go(`range=custom&from=${custom.from}&to=${custom.to}`);
        }}
      >
        <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-10 w-[9.5rem]" aria-label="From date" />
        <span className="text-muted-foreground">to</span>
        <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-10 w-[9.5rem]" aria-label="To date" />
        <Button type="submit" variant={active === "custom" ? "default" : "outline"} className="h-10" disabled={pending || !custom.from || !custom.to}>
          {pending ? <LoaderCircle className="animate-spin" /> : "Apply"}
        </Button>
      </form>
    </div>
  );
}
