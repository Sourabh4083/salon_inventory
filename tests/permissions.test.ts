import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";

describe("role permissions", () => {
  it("owner has every permission", () => {
    for (const p of ["product.create", "product.edit", "product.archive", "product.delete", "bill.create", "bill.view", "bill.cancel", "service.manage", "report.view", "stock.sale", "stock.in", "stock.adjust", "user.manage", "settings.manage", "category.manage"] as const) {
      expect(can("OWNER", p)).toBe(true);
    }
  });

  it("manager can run daily inventory", () => {
    for (const p of ["dashboard.view", "product.view", "product.create", "product.edit", "stock.sale", "stock.in", "stock.adjust", "stock.history.view", "bill.create", "bill.view"] as const) {
      expect(can("MANAGER", p)).toBe(true);
    }
  });

  it("manager cannot manage users, settings, categories, archive or delete products", () => {
    for (const p of ["user.manage", "settings.manage", "category.manage", "product.archive", "product.delete", "bill.cancel", "service.manage", "report.view"] as const) {
      expect(can("MANAGER", p)).toBe(false);
    }
  });
});
