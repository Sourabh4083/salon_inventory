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

export type Margin = { profit: string | null; marginPct: number | null; markupPct: number | null };

/**
 * Profit per unit and margins from decimal-string prices.
 * marginPct = profit / selling (share of the sale price that is profit),
 * markupPct = profit / cost (how much is added on top of cost).
 * Everything is null when a price is missing; a percentage is null when its divisor is 0.
 */
export function computeMargin(cost: string | null | undefined, selling: string | null | undefined): Margin {
  if (cost == null || cost === "" || selling == null || selling === "") return { profit: null, marginPct: null, markupPct: null };
  const c = toPaise(cost);
  const sp = toPaise(selling);
  const profit = sp - c;
  return {
    profit: fromPaise(profit),
    marginPct: sp > 0 ? Math.round((profit / sp) * 1000) / 10 : null,
    markupPct: c > 0 ? Math.round((profit / c) * 1000) / 10 : null,
  };
}
