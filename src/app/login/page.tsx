import type { Metadata } from "next";
import { Scissors } from "lucide-react";
import { LoginForm } from "@/components/app/login-form";
import { getSettings } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ next }, settings] = await Promise.all([searchParams, getSettings()]);
  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <section className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-primary/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-52 -left-32 size-[480px] rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Scissors className="size-5" />
          </span>
          <span className="font-heading text-xl leading-tight">{settings.businessName}</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="font-heading text-4xl leading-tight">Know exactly what is on your shelves.</h1>
          <p className="mt-4 text-base text-sidebar-foreground/75">
            Track hair systems, wigs, adhesives, tapes and salon products. Record sales and deliveries in seconds, and
            never run out of what your clients need.
          </p>
        </div>
        <p className="relative text-xs text-sidebar-foreground/50">Inventory Management · Version 1</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Scissors className="size-5" />
            </span>
            <span className="font-heading text-xl leading-tight">{settings.businessName}</span>
          </div>
          <h2 className="font-heading text-3xl">Welcome back</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to manage your inventory.</p>
          <div className="mt-8">
            <LoginForm next={next} />
          </div>
        </div>
      </section>
    </main>
  );
}
