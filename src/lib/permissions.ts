import type { Role } from "@/generated/prisma/enums";

export type Permission =
  | "dashboard.view"
  | "product.view"
  | "product.create"
  | "product.edit"
  | "product.archive"
  | "product.delete"
  | "stock.in"
  | "stock.sale"
  | "stock.adjust"
  | "stock.history.view"
  | "user.manage"
  | "settings.manage"
  | "category.manage"
  | "bill.create"
  | "bill.view"
  | "bill.cancel"
  | "service.manage"
  | "report.view"
  | "product.cost.view"
  | "product.price.edit"
  | "employee.manage";

const MANAGER_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "product.view",
  "product.create",
  "product.edit",
  "stock.in",
  "stock.sale",
  "stock.adjust",
  "bill.create",
  "bill.view",
];

const OWNER_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  "product.archive",
  "product.delete",
  "user.manage",
  "settings.manage",
  "category.manage",
  "bill.cancel",
  "service.manage",
  "report.view",
  "stock.history.view",
  "product.cost.view",
  "product.price.edit",
  "employee.manage",
];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * Product fields a manager may change ("basic product information").
 * Prices (cost and selling) are owner-only; the owner may change everything,
 * including the per-product low-stock threshold and status.
 */
export const MANAGER_EDITABLE_PRODUCT_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "categoryId",
  "sku",
  "barcode",
  "description",
  "unit",
  "location",
  "notes",
]);
