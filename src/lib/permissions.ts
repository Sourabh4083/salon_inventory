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
  | "employee.manage"
  | "order.view"
  | "order.receive"
  | "order.manage"
  | "employee.view"
  | "advance.record"
  | "expense.record"
  | "expense.manage"
  | "bill.edit"
  | "data.export"
  | "salary.view"
  | "bill.collect";

const MANAGER_PERMISSIONS: Permission[] = [
  "dashboard.view",
  "product.view",
  "product.create",
  "product.edit",
  "stock.in",
  "stock.sale",
  "bill.create",
  "bill.view",
  // Pay-later customers settle up at the counter, so whoever is there records it.
  "bill.collect",
  // Deliveries arrive while the manager runs the shop, so they can book them in.
  "order.view",
  "order.receive",
  // Staff take cash advances during the day; the manager notes them against the
  // employee (basic details only) and records the shop's small daily expenses.
  "employee.view",
  "advance.record",
  "expense.record",
  // When staff query their pay, the manager can show the monthly salary, the month's
  // advances and the balance to receive (not payment records or personal details).
  "salary.view",
];

const OWNER_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  // Owner-only: an adjustment rewrites the counted quantity in either direction,
  // so it stays with the person who reviews Stock Activity.
  "stock.adjust",
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
  "order.manage",
  "expense.manage",
  "bill.edit",
  "data.export",
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
