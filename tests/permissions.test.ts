import { describe, expect, it } from "vitest";
import { can, MANAGER_EDITABLE_PRODUCT_FIELDS } from "@/lib/permissions";

describe("role permissions", () => {
  it("owner has every permission", () => {
    for (const p of ["product.create", "product.edit", "product.archive", "product.delete", "bill.create", "bill.view", "bill.cancel", "service.manage", "report.view", "stock.sale", "stock.in", "stock.adjust", "user.manage", "settings.manage", "category.manage", "stock.history.view", "product.cost.view", "product.price.edit", "employee.manage", "order.view", "order.receive", "order.manage"] as const) {
      expect(can("OWNER", p)).toBe(true);
    }
  });

  it("manager can run daily inventory", () => {
    for (const p of ["dashboard.view", "product.view", "product.create", "product.edit", "stock.sale", "stock.in", "bill.create", "bill.view", "order.view", "order.receive"] as const) {
      expect(can("MANAGER", p)).toBe(true);
    }
  });

  it("manager cannot manage users, settings, categories, archive or delete products", () => {
    for (const p of ["user.manage", "settings.manage", "category.manage", "product.archive", "product.delete", "bill.cancel", "service.manage", "report.view"] as const) {
      expect(can("MANAGER", p)).toBe(false);
    }
  });

  it("manager cannot adjust stock, see cost prices, edit prices, view stock activity or manage employees", () => {
    for (const p of ["stock.adjust", "product.cost.view", "product.price.edit", "stock.history.view", "employee.manage", "order.manage"] as const) {
      expect(can("MANAGER", p)).toBe(false);
    }
    expect(MANAGER_EDITABLE_PRODUCT_FIELDS.has("costPrice")).toBe(false);
    expect(MANAGER_EDITABLE_PRODUCT_FIELDS.has("sellingPrice")).toBe(false);
    expect(MANAGER_EDITABLE_PRODUCT_FIELDS.has("name")).toBe(true);
  });
});
