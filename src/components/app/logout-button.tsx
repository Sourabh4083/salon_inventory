"use client";

import { useTransition } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function LogoutButton({ variant = "full" }: { variant?: "icon" | "full" }) {
  const [pending, startTransition] = useTransition();
  const onClick = () => startTransition(() => logoutAction());
  if (variant === "icon") {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-9 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        onClick={onClick}
        disabled={pending}
        aria-label="Log out"
        title="Log out"
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <LogOut />}
      </Button>
    );
  }
  return (
    <Button variant="outline" onClick={onClick} disabled={pending}>
      {pending ? <LoaderCircle className="animate-spin" /> : <LogOut />}
      Log out
    </Button>
  );
}
