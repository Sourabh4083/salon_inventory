"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LoaderCircle, Save } from "lucide-react";
import { updateSettingsAction } from "@/app/actions/settings";
import type { BusinessSettingsData } from "@/lib/services/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";

export function SettingsForm({ settings }: { settings: BusinessSettingsData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState({
    businessName: settings.businessName,
    currencyCode: settings.currencyCode,
    currencySymbol: settings.currencySymbol,
    lowStockThreshold: String(settings.lowStockThreshold),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    start(async () => {
      const res = await updateSettingsAction(values);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Settings saved", { description: `Low stock threshold is now ${res.data.lowStockThreshold}.` });
      router.refresh();
    });
  };

  const threshold = Number(values.lowStockThreshold);

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" noValidate>
      <h2 className="font-heading text-lg">Business</h2>
      <div className="mt-4 space-y-4">
        <Field label="Business name" htmlFor="businessName" required error={errors.businessName}>
          <Input id="businessName" className="h-11" value={values.businessName} onChange={(e) => setValues({ ...values, businessName: e.target.value })} aria-invalid={Boolean(errors.businessName)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Currency code" htmlFor="currencyCode" required error={errors.currencyCode} hint="e.g. INR">
            <Input id="currencyCode" className="h-11 uppercase" maxLength={3} value={values.currencyCode} onChange={(e) => setValues({ ...values, currencyCode: e.target.value.toUpperCase() })} aria-invalid={Boolean(errors.currencyCode)} />
          </Field>
          <Field label="Currency symbol" htmlFor="currencySymbol" required error={errors.currencySymbol} hint="e.g. ₹">
            <Input id="currencySymbol" className="h-11" maxLength={4} value={values.currencySymbol} onChange={(e) => setValues({ ...values, currencySymbol: e.target.value })} aria-invalid={Boolean(errors.currencySymbol)} />
          </Field>
        </div>
        <Field
          label="Low stock threshold"
          htmlFor="lowStockThreshold"
          required
          error={errors.lowStockThreshold}
          hint={
            Number.isFinite(threshold)
              ? `Products with 1–${threshold} units show as LOW STOCK. Above ${threshold} is IN STOCK. Zero is OUT OF STOCK.`
              : "Whole number, 0 or more."
          }
        >
          <Input id="lowStockThreshold" className="h-11 max-w-[8rem] text-lg font-semibold" inputMode="numeric" value={values.lowStockThreshold} onChange={(e) => setValues({ ...values, lowStockThreshold: e.target.value.replace(/[^0-9]/g, "") })} aria-invalid={Boolean(errors.lowStockThreshold)} />
        </Field>
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />} Save settings
        </Button>
      </div>
    </form>
  );
}
