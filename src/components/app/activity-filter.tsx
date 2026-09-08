"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NativeSelect } from "@/components/app/native-select";
import { MOVEMENT_LABEL } from "@/lib/constants";

export function ActivityFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <NativeSelect
      aria-label="Movement type"
      value={params.get("type") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("type", e.target.value);
        else next.delete("type");
        next.delete("page");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      }}
      className="h-11 w-full bg-card sm:w-48"
    >
      <option value="">All movements</option>
      {Object.entries(MOVEMENT_LABEL).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </NativeSelect>
  );
}
