"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, Check, LoaderCircle, Plus, Tags } from "lucide-react";
import { createCategoryAction, setCategoryNeedsServiceAction } from "@/app/actions/products";
import { SERVICE_EVERY_DAYS, REPLACE_AFTER_MONTHS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";
import { cn } from "@/lib/utils";

export function CategoryManager({ categories }: { categories: { id: string; name: string; needsService: boolean }[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createCategoryAction({ name });
      if (!res.ok) return setError(res.fieldErrors?.name ?? res.error);
      toast.success(`Category "${res.data.name}" added`);
      setName("");
    });
  };

  const toggleService = (c: { id: string; name: string; needsService: boolean }) => {
    setSavingId(c.id);
    start(async () => {
      const res = await setCategoryNeedsServiceAction({ id: c.id, needsService: !c.needsService });
      setSavingId(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.needsService ? `"${c.name}" buyers will be added to Calls for servicing` : `No more servicing calls for "${c.name}"`, {
        description: res.data.removedCalls ? res.data.removedCalls === 1 ? "1 call not yet made was removed from Calls." : `${res.data.removedCalls} calls not yet made were removed from Calls.` : undefined,
      });
    });
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <Tags className="size-4.5 text-primary" /> Product categories
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Categories help group hair systems, adhesives, tapes and more.</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id} className="rounded-full border bg-muted/40 px-3 py-1 text-sm">
            {c.name}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <Field label="New category" htmlFor="category-name" error={error ?? undefined} className="flex-1">
          <Input id="category-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Closure" maxLength={60} aria-invalid={Boolean(error)} />
        </Field>
        <Button type="submit" size="lg" className="h-11" disabled={pending || !name.trim()}>
          {pending && !savingId ? <LoaderCircle className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>

      <div className="mt-6 border-t pt-5">
        <h3 className="flex items-center gap-2 font-medium">
          <BellRing className="size-4 text-primary" /> Needs servicing
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap the categories whose products customers bring back for servicing. When one is sold to a customer with a mobile number, they appear on the Calls page
          every {SERVICE_EVERY_DAYS} days for servicing and after {REPLACE_AFTER_MONTHS} months for a replacement.
        </p>
        <div role="group" aria-label="Needs servicing" className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.needsService}
              disabled={pending}
              onClick={() => toggleService(c)}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-60",
                c.needsService ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-accent",
              )}
            >
              {savingId === c.id ? <LoaderCircle className="size-4 animate-spin" /> : c.needsService ? <Check className="size-4" /> : null} {c.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
