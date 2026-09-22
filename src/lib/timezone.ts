/**
 * The salon runs in one place, so every date the staff sees is rendered in one
 * fixed zone rather than in whatever zone the code happens to run in.
 *
 * This matters because the app renders dates on the server: `next dev` on a
 * laptop in India and a Vercel function in UTC would otherwise disagree by 5:30
 * about what "10:35 AM" or "today" means. Nothing here reads the host's zone.
 */
export const APP_TIMEZONE = "Asia/Kolkata";

/**
 * The zone naive `timestamp` columns are written in. Prisma's pg adapter renders
 * a JS Date into `TIMESTAMP(3)` using the *running process's* zone and Postgres
 * then drops the offset, so the stored wall clock only means something alongside
 * that zone — and the same applies to the Date values Prisma compares against in
 * `where` clauses. Raw SQL that reinterprets the column has to use the same one.
 *
 * (Storing `timestamptz` instead would remove the guesswork; that is a schema
 * migration plus a backfill, tracked separately.)
 */
export function runtimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export type ZonedParts = {
  year: number;
  /** 1-12, unlike Date#getMonth. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  // h23 keeps midnight at 0 rather than the 24 some engines produce with hour12: false.
  hourCycle: "h23",
});

/** The wall clock an instant shows in the salon's zone. */
export function zonedParts(date: Date): ZonedParts {
  const out = {} as Record<string, number>;
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== "literal") out[type] = Number(value);
  }
  return out as unknown as ZonedParts;
}

/** Offset of the salon's zone at this instant, in ms (zone time − UTC). */
function offsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * The instant at which the salon's zone reads the given wall clock — the
 * counterpart of `new Date(y, m, d, ...)`, but pinned to APP_TIMEZONE.
 */
export function zonedDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Resolve the offset at the guessed instant, then once more in case the guess
  // landed on the far side of a DST change. (India has none; other zones do.)
  const guess = new Date(wall - offsetMs(new Date(wall)));
  return new Date(wall - offsetMs(guess));
}

/** Midnight that starts this instant's day in the salon's zone. */
export function startOfDayInZone(date: Date): Date {
  const p = zonedParts(date);
  return zonedDate(p.year, p.month, p.day);
}

/** The last millisecond of this instant's day in the salon's zone. */
export function endOfDayInZone(date: Date): Date {
  const p = zonedParts(date);
  return zonedDate(p.year, p.month, p.day, 23, 59, 59, 999);
}

/** Midnight that starts the day `days` after this instant's day. */
export function addDaysInZone(date: Date, days: number): Date {
  const p = zonedParts(date);
  return zonedDate(p.year, p.month, p.day + days);
}

/** "2026-09-08" for the instant's day in the salon's zone. */
export function toDateParamInZone(date: Date): string {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
