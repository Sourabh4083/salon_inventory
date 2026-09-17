"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Aadhaar number masked by default (XXXX XXXX 1234) with a show / hide toggle. */
export function AadhaarNumber({ value }: { value: string | null }) {
  const [shown, setShown] = useState(false);
  if (!value) return <span>—</span>;
  const groups = value.match(/.{1,4}/g) ?? [value];
  const display = shown ? groups.join(" ") : `XXXX XXXX ${value.slice(-4)}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tracking-wider tabular-nums">{display}</span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={shown ? "Hide Aadhaar number" : "Show Aadhaar number"}
        aria-pressed={shown}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}
