/** Date-range helpers shared by the bills list and sales reports (local time). */

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** "2026-09-08" -> local Date at midnight; invalid input -> null */
export function parseDateParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateParam(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): { from: Date; to: Date; key: RangeKey } {
  const today = startOfDay(now);
  switch (params.range) {
    case "yesterday": {
      const y = new Date(today.getTime() - 86_400_000);
      return { from: y, to: endOfDay(y), key: "yesterday" };
    }
    case "7d":
      return { from: new Date(today.getTime() - 6 * 86_400_000), to: endOfDay(now), key: "7d" };
    case "30d":
      return { from: new Date(today.getTime() - 29 * 86_400_000), to: endOfDay(now), key: "30d" };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now), key: "month" };
    case "custom": {
      const from = parseDateParam(params.from) ?? today;
      const to = parseDateParam(params.to) ?? from;
      return from <= to ? { from, to: endOfDay(to), key: "custom" } : { from: to, to: endOfDay(from), key: "custom" };
    }
    default:
      return { from: today, to: endOfDay(now), key: "today" };
  }
}
