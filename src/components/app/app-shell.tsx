import { Scissors } from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { MobileNav } from "@/components/app/mobile-nav";
import { LogoutButton } from "@/components/app/logout-button";

export function AppShell({
  user,
  businessName,
  children,
}: {
  user: SessionUser;
  businessName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full">
      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-heading text-base leading-tight">{businessName}</p>
            <p className="text-[11px] tracking-wide text-sidebar-foreground/60 uppercase">Inventory</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav role={user.role} />
        </div>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60 capitalize">{user.role.toLowerCase()}</p>
            </div>
            <LogoutButton variant="icon" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav user={user} businessName={businessName} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
