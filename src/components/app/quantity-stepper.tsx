"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Large touch-friendly [-] 1 [+] control used in Sell / Add Stock dialogs.
 * Value is kept as a string so the user can clear and retype it.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
  id,
  autoFocus,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  id?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const n = Number.parseInt(value, 10);
  const current = Number.isFinite(n) ? n : min;
  const set = (next: number) => onChange(String(Math.max(min, max !== undefined ? Math.min(max, next) : next)));

  const btn =
    "flex size-12 shrink-0 items-center justify-center rounded-xl border bg-background text-foreground transition-colors hover:bg-muted active:translate-y-px disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} onClick={() => set(current - 1)} disabled={current <= min} aria-label="Decrease">
        <Minus className="size-5" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        value={value}
        autoFocus={autoFocus}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        aria-invalid={invalid}
        className={cn(
          "h-12 w-full min-w-0 rounded-xl border bg-background text-center text-2xl font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          invalid && "border-destructive ring-3 ring-destructive/20",
        )}
      />
      <button
        type="button"
        className={btn}
        onClick={() => set(current + 1)}
        disabled={max !== undefined && current >= max}
        aria-label="Increase"
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
