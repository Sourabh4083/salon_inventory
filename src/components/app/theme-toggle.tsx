"use client";

import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Switches this device between the day and night look. The root layout reads the cookie. */
export function ThemeToggle() {
  const router = useRouter();
  const toggle = () => {
    const night = document.documentElement.classList.toggle("dark");
    document.cookie = `theme=${night ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
    // The toaster and the browser bar colour come from the server.
    router.refresh();
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      onClick={toggle}
      aria-label="Switch between day and night mode"
      title="Day / night mode"
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </Button>
  );
}
