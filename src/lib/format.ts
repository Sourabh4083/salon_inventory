import { APP_TIMEZONE, addDaysInZone, startOfDayInZone, zonedParts } from "@/lib/timezone";

const inrFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Formats a money value (string/number) with Indian digit grouping: ₹13,500 */
export function formatMoney(value: string | number | null | undefined, symbol = "₹"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${symbol}${inrFormatter.format(n)}`;
}

export function formatNumber(n: number) {
  return inrFormatter.format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Pinned to the salon's zone: these run on the server, so the host's own zone
// (UTC on Vercel) must not decide what the clock reads.
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

function formatTime(d: Date) {
  return timeFormatter.format(d).toUpperCase();
}

function toDate(date: Date | string) {
  return typeof date === "string" ? new Date(date) : date;
}

/** "08 Sep 2026" */
export function formatDate(date: Date | string) {
  if (typeof date === "string") {
    // A bare "2026-09-08" is already a calendar date (report buckets, date inputs).
    // Shifting it through a zone would slide it onto the neighbouring day.
    const m = DATE_ONLY.exec(date);
    if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }
  const p = zonedParts(toDate(date));
  return `${pad(p.day)} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "08 Sep 2026, 11:20 AM" */
export function formatDateTime(date: Date | string) {
  const d = toDate(date);
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** "10:35 AM" for today, "Yesterday", otherwise "07 Sep 2026" */
export function formatRelative(date: Date | string, now = new Date()) {
  const d = toDate(date);
  const startOfToday = startOfDayInZone(now);
  const startOfYesterday = addDaysInZone(startOfToday, -1);
  if (d >= startOfToday) return formatTime(d);
  if (d >= startOfYesterday) return "Yesterday";
  return formatDate(d);
}

export function signedQuantity(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}
