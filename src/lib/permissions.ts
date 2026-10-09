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
  | "order.create"
  | "order.manage"
  | "employee.view"
  | "advance.record"
  | "expense.record"
  | "expense.manage"
  | "bill.edit"
  | "data.export"
  | "bill.collect"
  | "enquiry.manage"
  | "attendance.mark";

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
  // The manager sees what is running out, so they can place the order too. They
  // never see or type a cost; editing and closing an order stay with the owner.
  "order.create",
  // Staff take cash advances during the day; the manager notes them against the
  // employee (basic details only) and records the shop's small daily expenses.
  // Noting is all: the advances already taken, salaries and pay cuts are owner-only.
  "employee.view",
  "advance.record",
  "expense.record",
  // New-customer leads (JustDial/WhatsApp numbers, callers): the manager calls them
  // and notes what they said.
  "enquiry.manage",
  // The manager is in the shop every day, so they mark who came. Deciding whether a
  // leave is paid stays with the owner (employee.manage).
  "attendance.mark",
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
