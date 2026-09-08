import { z } from "zod";

const UNIT_VALUES = ["PIECE", "PACK", "BOX", "BOTTLE", "ROLL", "SET", "PAIR", "METER"] as const;

const trimmed = (max: number) => z.string().trim().max(max);

/** Optional text: empty string -> undefined/null */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Money input typed by humans: "600", "1,200.50", "" */
export const moneyInput = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null) return null;
    const raw = typeof v === "number" ? String(v) : v.replace(/[,\s₹]/g, "").trim();
    if (raw === "") return null;
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (up to 2 decimals)." });
      return z.NEVER;
    }
    if (Number(raw) > 9_999_999_999) {
      ctx.addIssue({ code: "custom", message: "Amount is too large." });
      return z.NEVER;
    }
    return raw;
  });

export const quantityInput = z.coerce
  .number({ message: "Enter a whole number." })
  .int("Enter a whole number.")
  .min(0, "Quantity cannot be negative.")
  .max(1_000_000, "Quantity is too large.");

export const positiveQuantityInput = z.coerce
  .number({ message: "Enter a whole number." })
  .int("Enter a whole number.")
  .min(1, "Quantity must be at least 1.")
  .max(1_000_000, "Quantity is too large.");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const productCreateSchema = z.object({
  name: trimmed(120).min(1, "Product name is required."),
  categoryId: z.string().min(1, "Select a category."),
  sellingPrice: moneyInput,
  costPrice: moneyInput,
  sku: optionalText(60).transform((v) => (v ? v.toUpperCase() : v)),
  barcode: optionalText(80),
  startingQuantity: quantityInput,
  unit: z.enum(UNIT_VALUES).default("PIECE"),
  location: optionalText(120),
  description: optionalText(2000),
  notes: optionalText(2000),
  lowStockThreshold: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(100000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});
export type ProductCreateInput = z.input<typeof productCreateSchema>;

export const productUpdateSchema = productCreateSchema.omit({ startingQuantity: true });
export type ProductUpdateInput = z.input<typeof productUpdateSchema>;

export const stockInSchema = z.object({
  productId: z.string().min(1),
  quantity: positiveQuantityInput,
  unitCost: moneyInput,
  note: optionalText(500),
});

export const saleSchema = z.object({
  productId: z.string().min(1),
  quantity: positiveQuantityInput,
  note: optionalText(500),
});

export const adjustmentSchema = z.object({
  productId: z.string().min(1),
  newQuantity: quantityInput,
  reason: trimmed(500).min(1, "Please give a reason for the adjustment."),
});

export const createManagerSchema = z.object({
  name: trimmed(80).min(1, "Name is required."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const updateManagerSchema = z.object({
  userId: z.string().min(1),
  name: trimmed(80).min(1, "Name is required."),
  isActive: z.boolean(),
});

export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const settingsSchema = z.object({
  businessName: trimmed(120).min(1, "Business name is required."),
  currencyCode: trimmed(3).min(3, "Use a 3-letter code such as INR.").toUpperCase(),
  currencySymbol: trimmed(4).min(1, "Currency symbol is required."),
  lowStockThreshold: z.coerce.number().int().min(0).max(100000),
});

export const categorySchema = z.object({
  name: trimmed(60).min(1, "Category name is required."),
});

/** Turns a Zod error into { field: message } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ---- Billing ----

const PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;

/** Required money: "0" allowed (free item), blank not allowed. */
const requiredMoney = moneyInput.transform((v, ctx) => {
  if (v === null) {
    ctx.addIssue({ code: "custom", message: "Enter a price." });
    return z.NEVER;
  }
  return v;
});

export const billItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PRODUCT"),
    productId: z.string().min(1),
    quantity: positiveQuantityInput,
    unitPrice: requiredMoney,
  }),
  z.object({
    kind: z.literal("SERVICE"),
    serviceId: z.string().min(1).optional().nullable(),
    name: trimmed(120).min(1, "Service name is required."),
    quantity: positiveQuantityInput,
    unitPrice: requiredMoney,
  }),
]);

export const billCreateSchema = z.object({
  items: z.array(billItemSchema).min(1, "Add at least one item to the bill."),
  customerName: optionalText(120),
  customerPhone: optionalText(20).transform((v, ctx) => {
    if (v && !/^[0-9+\-\s()]{6,20}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
    return v;
  }),
  discount: moneyInput.transform((v) => v ?? "0"),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  notes: optionalText(500),
});
export type BillCreateInput = z.input<typeof billCreateSchema>;
export type BillCreateData = z.output<typeof billCreateSchema>;

export const billCancelSchema = z.object({
  billId: z.string().min(1),
  reason: trimmed(300).min(3, "Give a short reason for cancelling."),
});

export const serviceSchema = z.object({
  name: trimmed(120).min(1, "Service name is required."),
  price: requiredMoney,
});
export type ServiceInput = z.input<typeof serviceSchema>;
