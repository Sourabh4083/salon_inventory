import type { Role } from "@/generated/prisma/enums";
import type { Permission } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: "dashboard" | "inventory" | "low" | "out" | "activity" | "users" | "settings" | "scan" | "billing" | "newbill" | "reports" | "pricing" | "employees";
  permission?: Permission;
  /** Marks the route as active for nested paths too. */
  exact?: boolean;
};

export type NavGroup = { label?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", exact: true }],
  },
  {
    label: "Billing",
    items: [
      { href: "/billing/new", label: "New Bill", icon: "newbill", permission: "bill.create" },
      { href: "/billing", label: "Bills", icon: "billing", permission: "bill.view", exact: true },
      { href: "/reports", label: "Sales Reports", icon: "reports", permission: "report.view" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/inventory", label: "All Products", icon: "inventory", exact: true },
      { href: "/inventory/low-stock", label: "Low Stock", icon: "low" },
      { href: "/inventory/out-of-stock", label: "Out of Stock", icon: "out" },
      { href: "/scan", label: "Scan Barcode", icon: "scan" },
      { href: "/pricing", label: "Prices & Margins", icon: "pricing", permission: "product.cost.view" },
    ],
  },
  {
    items: [{ href: "/activity", label: "Stock Activity", icon: "activity", permission: "stock.history.view" }],
  },
  {
    label: "Administration",
    items: [
      { href: "/users", label: "Users", icon: "users", permission: "user.manage" },
      { href: "/employees", label: "Employees", icon: "employees", permission: "employee.manage" },
      { href: "/settings", label: "Settings", icon: "settings", permission: "settings.manage" },
    ],
  },
];

export function isNavActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export { type Role };
