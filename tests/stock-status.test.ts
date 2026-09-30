import { describe, expect, it } from "vitest";
import { getStockStatus, effectiveThreshold } from "@/lib/stock-status";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { resolveRange, toDateParam } from "@/lib/dates";
import { zonedDate } from "@/lib/timezone";

/** A wall clock in the salon's zone, whatever zone the test host is in. */
const ist = (y: number, mo: number, d: number, h = 0, mi = 0) => zonedDate(y, mo, d, h, mi);

describe("stock status rule (threshold 4)", () => {
  it.each([
    [10, "IN_STOCK"],
    [5, "IN_STOCK"],
    [4, "LOW_STOCK"],
    [3, "LOW_STOCK"],
    [1, "LOW_STOCK"],
    [0, "OUT_OF_STOCK"],
  ])("quantity %i -> %s", (qty, expected) => {
    expect(getStockStatus(qty, 4)).toBe(expected);
  });

  it("respects a different shop-wide threshold", () => {
    expect(getStockStatus(6, 6)).toBe("LOW_STOCK");
    expect(getStockStatus(7, 6)).toBe("IN_STOCK");
    expect(getStockStatus(1, 0)).toBe("IN_STOCK");
  });

  it("uses a per-product override when present", () => {
    expect(effectiveThreshold(null, 4)).toBe(4);
    expect(effectiveThreshold(10, 4)).toBe(10);
  });
});

describe("formatting", () => {
  it("formats money with Indian grouping", () => {
    expect(formatMoney(800)).toBe("₹800");
    expect(formatMoney("1000")).toBe("₹1,000");
    expect(formatMoney("13500.00")).toBe("₹13,500");
    expect(formatMoney("1250000")).toBe("₹12,50,000");
    expect(formatMoney("-30")).toBe("-₹30");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats relative dates", () => {
    // Built in the salon's zone, not the host's, so these hold on a UTC CI box too.
    const now = ist(2026, 9, 8, 12, 0);
    expect(formatRelative(ist(2026, 9, 7, 9, 0), now)).toBe("Yesterday");
    expect(formatRelative(ist(2026, 9, 8, 10, 35), now)).toMatch(/10:35/i);
    expect(formatRelative(ist(2026, 9, 1, 10, 35), now)).toMatch(/01 Sep 2026/);
  });
});

describe("timestamps render in the salon's zone, not the host's", () => {
  // 2026-09-22T00:45:32Z is 06:15 in Kolkata: the case that showed 12:45 AM on Vercel.
  const earlyMorningIST = new Date("2026-09-22T00:45:32.190Z");

  it("formats a UTC instant as its IST wall clock", () => {
    expect(formatDateTime(earlyMorningIST)).toBe("22 Sep 2026, 06:15 AM");
    expect(formatDate(earlyMorningIST)).toBe("22 Sep 2026");
  });

  it("keeps an early-morning entry on today, not yesterday", () => {
    // 09:00 IST on the 22nd; the entry above is 06:15 IST the same day, but
    // 20:30 UTC on the 21st would have been bucketed as "Yesterday".
    const now = new Date("2026-09-22T03:30:00.000Z");
    expect(formatRelative(earlyMorningIST, now)).toMatch(/06:15/i);

    const lateNight = new Date("2026-09-21T20:30:00.000Z"); // 02:00 IST on the 22nd
    expect(formatRelative(lateNight, now)).toMatch(/02:00/i);
  });

  it("treats a bare YYYY-MM-DD as a calendar date, with no zone shift", () => {
    expect(formatDate("2026-09-08")).toBe("08 Sep 2026");
  });

  it("resolves day ranges on IST boundaries", () => {
    // 09:00 IST on the 22nd -> the day runs 00:00-23:59:59.999 IST.
    const now = new Date("2026-09-22T03:30:00.000Z");
    const today = resolveRange({ range: "today" }, now);
    expect(today.from.toISOString()).toBe("2026-09-21T18:30:00.000Z");
    expect(today.to.toISOString()).toBe("2026-09-22T18:29:59.999Z");

    const yesterday = resolveRange({ range: "yesterday" }, now);
    expect(yesterday.from.toISOString()).toBe("2026-09-20T18:30:00.000Z");
    expect(toDateParam(yesterday.from)).toBe("2026-09-21");
  });
});
