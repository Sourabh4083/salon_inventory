"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { LoaderCircle, Save } from "lucide-react";
import { createProductAction, updateProductAction } from "@/app/actions/products";
import type { ProductDTO } from "@/lib/services/products";
import type { ProductCreateInput } from "@/lib/validation/schemas";
import { UNITS } from "@/lib/constants";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/field";
import { NativeSelect } from "@/components/app/native-select";
import { QuantityStepper } from "@/components/app/quantity-stepper";

type Category = { id: string; name: string };

type FormValues = {
  name: string;
  categoryId: string;
  sellingPrice: string;
  costPrice: string;
  sku: string;
  barcode: string;
  startingQuantity: string;
  unit: string;
  location: string;
  description: string;
  notes: string;
  lowStockThreshold: string;
};

export function ProductForm({
  categories,
  currencySymbol,
  product,
  isOwner,
  globalThreshold,
}: {
  categories: Category[];
  currencySymbol: string;
  product?: ProductDTO;
  isOwner: boolean;
  globalThreshold: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const editing = Boolean(product);

  const form = useForm<FormValues>({
    defaultValues: {
      name: product?.name ?? "",
      categoryId: product?.categoryId ?? categories[0]?.id ?? "",
      sellingPrice: product?.sellingPrice ?? "",
      costPrice: product?.costPrice ?? "",
      sku: product?.sku ?? "",
      barcode: product?.barcode ?? "",
      startingQuantity: "0",
      unit: product?.unit ?? "PIECE",
      location: product?.location ?? "",
      description: product?.description ?? "",
      notes: product?.notes ?? "",
      lowStockThreshold: product?.lowStockThreshold != null ? String(product.lowStockThreshold) : "",
    },
  });
  const { register, handleSubmit, control, setValue, formState } = form;
  const startingQuantity = useWatch({ control, name: "startingQuantity" });
  const errors = { ...serverErrors };
  for (const [k, v] of Object.entries(formState.errors)) if (v?.message) errors[k] = String(v.message);

  const onSubmit = (values: FormValues) => {
    setServerErrors({});
    setFormError(null);
    const payload: ProductCreateInput = {
      name: values.name,
      categoryId: values.categoryId,
      // Prices are owner-only; the server ignores them for managers anyway.
      sellingPrice: isOwner ? values.sellingPrice : "",
      costPrice: isOwner ? values.costPrice : "",
      sku: values.sku,
      barcode: values.barcode,
      startingQuantity: values.startingQuantity === "" ? 0 : Number(values.startingQuantity),
      unit: values.unit as ProductCreateInput["unit"],
      location: values.location,
      description: values.description,
      notes: values.notes,
      lowStockThreshold: values.lowStockThreshold === "" ? "" : Number(values.lowStockThreshold),
    };
    start(async () => {
      const res = editing ? await updateProductAction(product!.id, payload) : await createProductAction(payload);
      if (!res.ok) {
        setServerErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(editing ? "Product updated" : "Product saved", { description: `${res.data.name} · Stock ${res.data.quantity}` });
      router.push(`/inventory/${res.data.id}`);
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Basic information</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
            <Input id="name" className="h-11 text-base" placeholder="e.g. Italian Glue" autoFocus={!editing} {...register("name", { required: "Product name is required." })} aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Category" htmlFor="categoryId" required error={errors.categoryId}>
            <NativeSelect id="categoryId" className="h-11" {...register("categoryId", { required: "Select a category." })} aria-invalid={Boolean(errors.categoryId)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Unit" htmlFor="unit" error={errors.unit}>
            <NativeSelect id="unit" className="h-11" {...register("unit")}>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {isOwner ? (
            <>
              <Field label={`Selling price (${currencySymbol})`} htmlFor="sellingPrice" error={errors.sellingPrice}>
                <Input id="sellingPrice" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 600" {...register("sellingPrice")} aria-invalid={Boolean(errors.sellingPrice)} />
              </Field>
              <Field label={`Cost price (${currencySymbol})`} htmlFor="costPrice" error={errors.costPrice} hint="Only the owner can see and change cost price.">
                <Input id="costPrice" className="h-11 text-base" inputMode="decimal" placeholder="e.g. 450" {...register("costPrice")} aria-invalid={Boolean(errors.costPrice)} />
              </Field>
            </>
          ) : (
            <Field label={`Selling price (${currencySymbol})`} hint="Prices are set by the owner.">
              <p className="flex h-11 items-center rounded-lg border border-dashed bg-muted/40 px-3 text-base font-medium tabular-nums">
                {editing ? formatMoney(product?.sellingPrice, currencySymbol) : "Set by owner after saving"}
              </p>
            </Field>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Identification</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SKU" htmlFor="sku" error={errors.sku} hint="Optional. Must be unique if entered.">
            <Input id="sku" className="h-11 font-mono text-base" placeholder="e.g. GLU-ITL-01" autoCapitalize="characters" {...register("sku")} aria-invalid={Boolean(errors.sku)} />
          </Field>
          <Field label="Barcode" htmlFor="barcode" error={errors.barcode} hint="Optional. Scan with a USB scanner or type it in.">
            <Input id="barcode" className="h-11 font-mono text-base" inputMode="numeric" placeholder="e.g. 8901234567890" {...register("barcode")} aria-invalid={Boolean(errors.barcode)} />
          </Field>
          <Field label="Location" htmlFor="location" error={errors.location} hint="Shelf, drawer or cabinet.">
            <Input id="location" className="h-11 text-base" placeholder="e.g. Shelf A2" {...register("location")} />
          </Field>
          {isOwner ? (
            <Field label="Low stock threshold (override)" htmlFor="lowStockThreshold" error={errors.lowStockThreshold} hint={`Leave blank to use the shop-wide threshold (${globalThreshold}).`}>
              <Input id="lowStockThreshold" className="h-11 text-base" inputMode="numeric" placeholder={String(globalThreshold)} {...register("lowStockThreshold")} aria-invalid={Boolean(errors.lowStockThreshold)} />
            </Field>
          ) : null}
        </div>
      </section>

      {!editing ? (
        <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
          <h2 className="font-heading text-lg">Starting stock</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How many units are on hand right now? An <span className="font-medium">initial stock</span> entry is recorded if this is above zero.
          </p>
          <div className="mt-4 max-w-xs">
            <Field label="Starting quantity" htmlFor="startingQuantity" required error={errors.startingQuantity}>
              <QuantityStepper id="startingQuantity" min={0} value={startingQuantity} onChange={(v) => setValue("startingQuantity", v)} />
            </Field>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border bg-card p-4 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Details</h2>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Description" htmlFor="description" error={errors.description}>
            <Textarea id="description" rows={3} placeholder="Size, length, colour, base type..." {...register("description")} />
          </Field>
          <Field label="Notes" htmlFor="notes" error={errors.notes}>
            <Textarea id="notes" rows={2} placeholder="Internal notes (supplier, reorder hints...)" {...register("notes")} />
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
          {editing ? "Save changes" : "Save product"}
        </Button>
      </div>
    </form>
  );
}
