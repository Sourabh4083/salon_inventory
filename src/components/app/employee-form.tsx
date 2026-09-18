"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { LoaderCircle, Save } from "lucide-react";
import { createEmployeeAction, updateEmployeeAction } from "@/app/actions/employees";
import type { EmployeeDTO } from "@/lib/services/employees";
import type { EmployeeInput } from "@/lib/validation/schemas";
import { toDateParam } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";

type FormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  designation: string;
  joinedAt: string;
  leftAt: string;
  aadhaarNumber: string;
  monthlySalary: string;
  notes: string;
};

function dateInput(iso: string | null | undefined) {
  return iso ? toDateParam(new Date(iso)) : "";
}

export function EmployeeForm({ currencySymbol, employee }: { currencySymbol: string; employee?: EmployeeDTO }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(employee);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: {
      name: employee?.name ?? "",
      phone: employee?.phone ?? "",
      email: employee?.email ?? "",
      address: employee?.address ?? "",
      designation: employee?.designation ?? "",
      joinedAt: dateInput(employee?.joinedAt),
      leftAt: dateInput(employee?.leftAt),
      aadhaarNumber: employee?.aadhaarNumber ?? "",
      monthlySalary: employee?.monthlySalary ?? "",
      notes: employee?.notes ?? "",
    },
  });
  const errors = { ...serverErrors };
  for (const [k, v] of Object.entries(formState.errors)) if (v?.message) errors[k] = String(v.message);

  const onSubmit = (values: FormValues) => {
    setServerErrors({});
    setFormError(null);
    const payload: EmployeeInput = { ...values };
    start(async () => {
      const res = editing ? await updateEmployeeAction(employee!.id, payload) : await createEmployeeAction(payload);
      if (!res.ok) {
        setServerErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(editing ? "Employee updated" : "Employee added", { description: res.data.name });
      router.push(`/employees/${res.data.id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Personal details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
            <Input id="name" className="h-11 text-base" placeholder="e.g. Priya Sharma" autoFocus={!editing} {...register("name", { required: "Name is required." })} aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" className="h-11 text-base" inputMode="tel" placeholder="e.g. 9876543210" {...register("phone")} aria-invalid={Boolean(errors.phone)} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" className="h-11 text-base" inputMode="email" placeholder="optional" {...register("email")} aria-invalid={Boolean(errors.email)} />
          </Field>
          <Field label="Address" htmlFor="address" error={errors.address} className="sm:col-span-2">
            <Textarea id="address" rows={2} placeholder="House / street, area, city" {...register("address")} />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Employment &amp; salary</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Designation" htmlFor="designation" error={errors.designation} hint="e.g. Stylist, Helper, Receptionist">
            <Input id="designation" className="h-11 text-base" placeholder="e.g. Stylist" {...register("designation")} />
          </Field>
          <Field label={`Monthly salary (${currencySymbol})`} htmlFor="monthlySalary" error={errors.monthlySalary} hint="Agreed salary. Actual payments are recorded on the employee page.">
            <Input id="monthlySalary" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 15000" {...register("monthlySalary")} aria-invalid={Boolean(errors.monthlySalary)} />
          </Field>
          <Field label="Joining date" htmlFor="joinedAt" error={errors.joinedAt}>
            <Input id="joinedAt" type="date" className="h-11 text-base" {...register("joinedAt")} aria-invalid={Boolean(errors.joinedAt)} />
          </Field>
          <Field label="Leaving date" htmlFor="leftAt" error={errors.leftAt} hint="Leave blank while the employee is working.">
            <Input id="leftAt" type="date" className="h-11 text-base" {...register("leftAt")} aria-invalid={Boolean(errors.leftAt)} />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Identity (Aadhaar)</h2>
        <p className="mt-1 text-sm text-muted-foreground">Aadhaar card photos or PDF are uploaded from the employee page after saving.</p>
        <div className="mt-4 max-w-sm">
          <Field label="Aadhaar number" htmlFor="aadhaarNumber" error={errors.aadhaarNumber} hint="12 digits. Shown masked; only the owner can see it.">
            <Input id="aadhaarNumber" className="h-11 font-mono text-base tracking-wider" inputMode="numeric" placeholder="1234 5678 9012" maxLength={14} {...register("aadhaarNumber")} aria-invalid={Boolean(errors.aadhaarNumber)} />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Notes</h2>
        <div className="mt-4">
          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" rows={3} placeholder="Emergency contact, bank details, leave arrangements..." {...register("notes")} />
          </Field>
        </div>
      </section>

      {formError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <Button type="button" variant="outline" size="lg" className="h-11 flex-1 sm:flex-none" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11 flex-1 sm:flex-none" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <Save />}
          {editing ? "Save changes" : "Save employee"}
        </Button>
      </div>
    </form>
  );
}
