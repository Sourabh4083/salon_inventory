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

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatTime(d: Date) {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(d).toUpperCase();
}

/** "08 Sep 2026" */
export function formatDate(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "08 Sep 2026, 11:20 AM" */
export function formatDateTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** "10:35 AM" for today, "Yesterday", otherwise "07 Sep 2026" */
export function formatRelative(date: Date | string, now = new Date()) {
  const d = typeof date === "string" ? new Date(date) : date;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  if (d >= startOfToday) return formatTime(d);
  if (d >= startOfYesterday) return "Yesterday";
  return formatDate(d);
}

export function signedQuantity(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}
