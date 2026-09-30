import { addDaysInZone, endOfDayInZone, startOfDayInZone, toDateParamInZone, zonedDate, zonedParts } from "@/lib/timezone";

/**
 * Date-range helpers shared by the bills list and sales reports. Every boundary is
 * a day boundary in the salon's zone, not in the zone the server happens to run in
 * — otherwise "Today" on a UTC host would mean 5:30 AM today to 5:29 AM tomorrow.
 */

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

export function startOfDay(d: Date) {
  return startOfDayInZone(d);
}

export function endOfDay(d: Date) {
  return endOfDayInZone(d);
}

/** "2026-09-08" -> that day's midnight in the salon's zone; invalid input -> null */
export function parseDateParam(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = zonedDate(y, m, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDateParam(d: Date) {
  return toDateParamInZone(d);
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, now = new Date()): { from: Date; to: Date; key: RangeKey } {
  const today = startOfDay(now);
  switch (params.range) {
    case "yesterday": {
      const y = addDaysInZone(today, -1);
      return { from: y, to: endOfDay(y), key: "yesterday" };
    }
    case "7d":
      return { from: addDaysInZone(today, -6), to: endOfDay(now), key: "7d" };
    case "30d":
      return { from: addDaysInZone(today, -29), to: endOfDay(now), key: "30d" };
    case "month": {
      const p = zonedParts(now);
      return { from: zonedDate(p.year, p.month, 1), to: endOfDay(now), key: "month" };
    }
    case "custom": {
      const from = parseDateParam(params.from) ?? today;
      const to = parseDateParam(params.to) ?? from;
      return from <= to ? { from, to: endOfDay(to), key: "custom" } : { from: to, to: endOfDay(from), key: "custom" };
    }
    default:
      return { from: today, to: endOfDay(now), key: "today" };
  }
}

/* ---------- Calendar months ("2026-09") ---------- */

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-09" for the month this instant falls in, in the salon's zone. */
export function toMonthParam(d: Date = new Date()) {
  return toDateParamInZone(d).slice(0, 7);
}

export function isMonthParam(value: string | undefined | null): value is string {
  return Boolean(value && MONTH_PARAM.test(value));
}

/** First and last instant of a "YYYY-MM" month in the salon's zone. */
export function monthRange(month: string): { from: Date; to: Date } {
  const m = MONTH_PARAM.exec(month);
  if (!m) throw new Error(`Invalid month "${month}"`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const from = zonedDate(year, mon, 1);
  const to = new Date(zonedDate(year, mon + 1, 1).getTime() - 1);
  return { from, to };
}

/** "Sep 2026" */
export function formatMonth(month: string) {
  const m = MONTH_PARAM.exec(month);
  if (!m) return month;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1]}`;
}
