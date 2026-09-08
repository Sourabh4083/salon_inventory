"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, Scissors } from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { LogoutButton } from "@/components/app/logout-button";

export function MobileNav({ user, businessName }: { user: SessionUser; businessName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon-lg" aria-label="Open navigation" className="size-11" />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[85vw] max-w-xs gap-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="border-b border-sidebar-border px-5 py-4 text-left">
            <SheetTitle className="flex items-center gap-3 text-sidebar-foreground">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Scissors className="size-4" />
              </span>
              <span className="font-heading text-base">{businessName}</span>
            </SheetTitle>
            <SheetDescription className="sr-only">Navigation menu</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3">
            <SidebarNav role={user.role} onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-3 px-2 py-2">
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
        </SheetContent>
      </Sheet>
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Scissors className="size-4" />
        </span>
        <span className="truncate font-heading text-base">{businessName}</span>
      </Link>
    </header>
  );
}
