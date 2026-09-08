import { describe, expect, it } from "vitest";
import { getStockStatus, effectiveThreshold } from "@/lib/stock-status";
import { formatMoney, formatRelative } from "@/lib/format";

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
    expect(formatMoney(null)).toBe("—");
  });

  it("formats relative dates", () => {
    const now = new Date(2026, 8, 8, 12, 0);
    expect(formatRelative(new Date(2026, 8, 7, 9, 0), now)).toBe("Yesterday");
    expect(formatRelative(new Date(2026, 8, 8, 10, 35), now)).toMatch(/10:35/i);
    expect(formatRelative(new Date(2026, 8, 1, 10, 35), now)).toMatch(/01 Sep 2026/);
  });
});
