"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, LoaderCircle, Pencil, Plus, Scissors, X } from "lucide-react";
import { createServiceAction, updateServiceAction } from "@/app/actions/billing";
import type { ServiceDTO } from "@/lib/services/billing";
import { formatMoney } from "@/lib/format";
import { trimMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/app/field";

export function ServicesManager({ services, currencySymbol }: { services: ServiceDTO[]; currencySymbol: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({ name: "", price: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; name: string; price: string } | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    start(async () => {
      const res = await createServiceAction(draft);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { name: res.error });
        return;
      }
      toast.success(`Service "${res.data.name}" added`);
      setDraft({ name: "", price: "" });
      router.refresh();
    });
  };

  const saveEdit = () => {
    if (!editing) return;
    start(async () => {
      const res = await updateServiceAction(editing.id, { name: editing.name, price: editing.price });
      if (!res.ok) {
        toast.error(res.fieldErrors?.name ?? res.fieldErrors?.price ?? res.error);
        return;
      }
      toast.success(`Service "${res.data.name}" updated`);
      setEditing(null);
      router.refresh();
    });
  };

  const toggle = (s: ServiceDTO) => {
    start(async () => {
      const res = await updateServiceAction(s.id, { isActive: !s.isActive });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data.isActive ? `"${res.data.name}" is available on bills` : `"${res.data.name}" hidden from bills`);
      router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <Scissors className="size-4.5 text-primary" /> Salon services
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Services appear as one-tap buttons on the New Bill screen. Hidden services stay on old bills.</p>

      {services.length ? (
        <ul className="mt-4 divide-y">
          {services.map((s) =>
            editing?.id === s.id ? (
              <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <Input className="h-10 flex-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} aria-label="Service name" />
                <Input className="h-10 sm:w-32" inputMode="decimal" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} aria-label="Price" />
                <div className="flex gap-1">
                  <Button size="icon-lg" onClick={saveEdit} disabled={pending || !editing.name.trim()} aria-label="Save">
                    {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
                  </Button>
                  <Button size="icon-lg" variant="ghost" onClick={() => setEditing(null)} disabled={pending} aria-label="Cancel">
                    <X />
                  </Button>
                </div>
              </li>
            ) : (
              <li key={s.id} className={cn("flex items-center gap-3 py-3", !s.isActive && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{formatMoney(s.price, currencySymbol)}</p>
                </div>
                <Button size="icon-lg" variant="ghost" onClick={() => setEditing({ id: s.id, name: s.name, price: trimMoney(s.price) })} aria-label={`Edit ${s.name}`}>
                  <Pencil />
                </Button>
                <Switch checked={s.isActive} onCheckedChange={() => toggle(s)} disabled={pending} aria-label={`${s.name} available on bills`} />
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No services yet. Add haircut, styling, colouring and so on.</p>
      )}

      <form onSubmit={add} className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
        <Field label="New service" htmlFor="service-name" error={errors.name} className="flex-1">
          <Input id="service-name" className="h-11" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Haircut" maxLength={120} aria-invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Price" htmlFor="service-price" error={errors.price} className="sm:w-36">
          <Input id="service-price" className="h-11" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="300" aria-invalid={Boolean(errors.price)} />
        </Field>
        <Button type="submit" size="lg" className="h-11" disabled={pending || !draft.name.trim() || !draft.price.trim()}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>
    </section>
  );
}
