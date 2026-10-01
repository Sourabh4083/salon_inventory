"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  BadgePercent,
  BarChart3,
  CalendarCheck2,
  Contact,
  Receipt,
  ReceiptText,
  LayoutDashboard,
  PackageSearch,
  Truck,
  Wallet,
  PackageX,
  PhoneCall,
  ScanBarcode,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, isNavActive, type NavItem, type Role } from "@/lib/nav";
import { can } from "@/lib/permissions";

const ICONS: Record<NavItem["icon"], React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  inventory: PackageSearch,
  low: AlertTriangle,
  out: PackageX,
  activity: Activity,
  users: Users,
  settings: Settings,
  scan: ScanBarcode,
  billing: ReceiptText,
  newbill: Receipt,
  reports: BarChart3,
  pricing: BadgePercent,
  employees: Contact,
  orders: Truck,
  expenses: Wallet,
  calls: PhoneCall,
  attendance: CalendarCheck2,
};

export function SidebarNav({ role, onNavigate, className }: { role: Role; onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("space-y-5 py-2", className)} aria-label="Main">
      {NAV_GROUPS.map((group, i) => {
        const items = group.items.filter((item) => !item.permission || can(role, item.permission));
        if (!items.length) return null;
        return (
          <div key={i}>
            {group.label ? (
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isNavActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className="size-4.5 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
