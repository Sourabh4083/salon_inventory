/**
 * Money helpers. Amounts travel through the app as decimal strings ("600.50").
 * Arithmetic is done in integer paise to avoid floating-point drift.
 */
export function toPaise(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** "600.00" -> "600", "600.50" -> "600.50" (for compact display/inputs). */
export function trimMoney(value: string): string {
  return value.replace(/\.00$/, "");
}
