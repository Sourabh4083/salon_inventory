"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LoaderCircle, Plus, Tags } from "lucide-react";
import { createCategoryAction } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";

export function CategoryManager({ categories }: { categories: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
          {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>
    </section>
  );
}
