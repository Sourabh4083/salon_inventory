import { z } from "zod";
import { zonedDate } from "@/lib/timezone";

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

/** Owner-only price edit from the Prices & Margins page. */
export const productPricesSchema = z.object({
  costPrice: moneyInput,
  sellingPrice: moneyInput,
});
export type ProductPricesInput = z.input<typeof productPricesSchema>;

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

const optionalPhone = optionalText(20).transform((v, ctx) => {
  if (v && !/^[0-9+\-\s()]{6,20}$/.test(v)) {
    ctx.addIssue({ code: "custom", message: "Enter a valid phone number." });
    return z.NEVER;
  }
  return v;
});

const billBase = z.object({
  items: z.array(billItemSchema).min(1, "Add at least one item to the bill."),
  customerName: optionalText(120),
  customerPhone: optionalPhone,
  discount: moneyInput.transform((v) => v ?? "0"),
  /** Method of the money taken at the counter (the whole bill, or "paidNow" on a pay-later bill). */
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  /** The customer pays the rest later; the bill stays unpaid until the balance is collected. */
  payLater: z.boolean().default(false),
  /** Pay later only: what was paid at the counter now (0 = nothing). */
  paidNow: moneyInput.transform((v) => v ?? "0"),
  notes: optionalText(500),
});

/** A pay-later bill must say who owes the money. */
function requireCustomerForPayLater(v: { payLater: boolean; customerName: string | null; customerPhone: string | null }, ctx: z.RefinementCtx) {
  if (!v.payLater) return;
  if (!v.customerName) ctx.addIssue({ code: "custom", path: ["customerName"], message: "Enter the customer's name for a pay-later bill." });
  if (!v.customerPhone) ctx.addIssue({ code: "custom", path: ["customerPhone"], message: "Enter the customer's phone for a pay-later bill." });
}

export const billCreateSchema = billBase
  .extend({
    /** Set when an open bill is being completed; it is removed together with making the bill. */
    openBillId: z.string().min(1).optional(),
  })
  .superRefine(requireCustomerForPayLater);
export type BillCreateInput = z.input<typeof billCreateSchema>;
export type BillCreateData = z.output<typeof billCreateSchema>;

// ---- Open bills (customer still in the shop) ----

/** Lines are kept as typed: a price may still be blank until the bill is completed. */
const openBillItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PRODUCT"),
    productId: z.string().min(1),
    name: trimmed(120),
    quantity: positiveQuantityInput,
    unitPrice: trimmed(20),
  }),
  z.object({
    kind: z.literal("SERVICE"),
    serviceId: z.string().min(1).optional().nullable(),
    name: trimmed(120).min(1, "Service name is required."),
    quantity: positiveQuantityInput,
    unitPrice: trimmed(20),
  }),
]);

export const openBillSchema = z.object({
  /** Given when adding to a bill that is already open. */
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1, "Choose the employee handling this customer."),
  customerName: optionalText(120),
  customerPhone: optionalPhone,
  discount: optionalText(20),
  notes: optionalText(500),
  items: z.array(openBillItemSchema).min(1, "Add at least one product or service."),
});
export type OpenBillInput = z.input<typeof openBillSchema>;
export type OpenBillData = z.output<typeof openBillSchema>;

export const billCancelSchema = z.object({
  billId: z.string().min(1),
  reason: trimmed(300).min(3, "Give a short reason for cancelling."),
});

export const serviceSchema = z.object({
  name: trimmed(120).min(1, "Service name is required."),
  price: requiredMoney,
});
export type ServiceInput = z.input<typeof serviceSchema>;

// ---- Product orders ----

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: positiveQuantityInput,
  unitCost: moneyInput,
});

export const orderCreateSchema = z.object({
  items: z.array(orderItemSchema).min(1, "Add at least one product to the order.").max(200, "An order can have at most 200 products."),
  notes: optionalText(500),
});
export type OrderCreateInput = z.input<typeof orderCreateSchema>;
export type OrderCreateData = z.output<typeof orderCreateSchema>;

export const orderReceiveSchema = z.object({
  orderId: z.string().min(1),
  /** "ALL" receives everything still pending; otherwise the quantity that arrived per line (0 = not arrived). */
  lines: z.union([
    z.literal("ALL"),
    z.array(z.object({ itemId: z.string().min(1), quantity: quantityInput })).min(1),
  ]),
});
export type OrderReceiveInput = z.input<typeof orderReceiveSchema>;
export type OrderReceiveData = z.output<typeof orderReceiveSchema>;

export const orderCloseSchema = z.object({
  orderId: z.string().min(1),
  reason: trimmed(300).min(3, "Give a short reason for closing."),
});

// ---- Employees (owner-only) ----

/** "2026-09-18" -> midnight that day in the salon's zone | null. Blank allowed. */
const optionalDateInput = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a date as YYYY-MM-DD." });
      return z.NEVER;
    }
    const [y, mo, day] = v.split("-").map(Number);
    const d = zonedDate(y, mo, day);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return d;
  });

const requiredDateInput = z
  .string()
  .trim()
  .min(1, "Enter a date.")
  .transform((v, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a date as YYYY-MM-DD." });
      return z.NEVER;
    }
    const [y, mo, day] = v.split("-").map(Number);
    const d = zonedDate(y, mo, day);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return d;
  });

const phoneInput = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const digits = v.replace(/[\s\-()+]/g, "");
    if (!/^\d{10,15}$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: "Enter a phone number with 10 to 15 digits." });
      return z.NEVER;
    }
    return digits;
  });

const aadhaarInput = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const digits = v.replace(/\s/g, "");
    if (!/^\d{12}$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: "Aadhaar number must be 12 digits." });
      return z.NEVER;
    }
    return digits;
  });

export const employeeSchema = z.object({
  name: trimmed(120).min(1, "Name is required."),
  phone: phoneInput,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const lower = v.toLowerCase();
      if (!z.string().email().safeParse(lower).success) {
        ctx.addIssue({ code: "custom", message: "Enter a valid email address." });
        return z.NEVER;
      }
      return lower;
    }),
  address: optionalText(500),
  designation: optionalText(80),
  joinedAt: optionalDateInput,
  leftAt: optionalDateInput,
  aadhaarNumber: aadhaarInput,
  monthlySalary: moneyInput,
  notes: optionalText(1000),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

export const salaryPaymentSchema = z.object({
  employeeId: z.string().min(1),
  amount: requiredMoney.transform((v, ctx) => {
    if (Number(v) <= 0) {
      ctx.addIssue({ code: "custom", message: "Amount must be more than 0." });
      return z.NEVER;
    }
    return v;
  }),
  paidOn: requiredDateInput,
  periodMonth: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) {
        ctx.addIssue({ code: "custom", message: "Enter the month as YYYY-MM." });
        return z.NEVER;
      }
      return v;
    }),
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
  note: optionalText(300),
  /** Advances taken that month and subtracted from this payment. */
  advanceDeducted: moneyInput,
  /** Pay cut for absent days / unpaid leave that month, subtracted from this payment. */
  absenceDeducted: moneyInput,
});
export type SalaryPaymentInput = z.input<typeof salaryPaymentSchema>;

export const EMPLOYEE_DOC_KINDS = ["AADHAAR_FRONT", "AADHAAR_BACK", "OTHER"] as const;
export const employeeDocumentKindSchema = z.enum(EMPLOYEE_DOC_KINDS).default("OTHER");

/** Required money that must be more than zero. */
const positiveMoney = requiredMoney.transform((v, ctx) => {
  if (Number(v) <= 0) {
    ctx.addIssue({ code: "custom", message: "Amount must be more than 0." });
    return z.NEVER;
  }
  return v;
});

// ---- Employee advances ----

export const advanceSchema = z.object({
  employeeId: z.string().min(1),
  amount: positiveMoney,
  /** Owner only; the manager's entries are always dated today. */
  takenOn: optionalDateInput,
  note: optionalText(300),
});
export type AdvanceInput = z.input<typeof advanceSchema>;
export type AdvanceData = z.output<typeof advanceSchema>;

// ---- Shop expenses ----

export const expenseSchema = z.object({
  amount: positiveMoney,
  description: trimmed(200).min(1, "Write what the money was spent on."),
  /** Owner only; the manager's entries are always dated today. */
  spentOn: optionalDateInput,
  paymentMethod: z.enum(PAYMENT_METHODS).default("CASH"),
});
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseData = z.output<typeof expenseSchema>;

// ---- Bill editing (owner) ----

export const billUpdateSchema = billBase
  .extend({
  billId: z.string().min(1),
  /** "2026-09-27T18:30" typed in the salon's local time. */
  billedAt: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
      const d = m ? zonedDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) : null;
      if (!d || Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Enter the bill date and time." });
        return z.NEVER;
      }
      return d;
    }),
  })
  .superRefine(requireCustomerForPayLater);
export type BillUpdateInput = z.input<typeof billUpdateSchema>;
export type BillUpdateData = z.output<typeof billUpdateSchema>;

// ---- Collecting a bill's balance ----

export const billPaymentSchema = z.object({
  billId: z.string().min(1),
  amount: positiveMoney,
  method: z.enum(PAYMENT_METHODS).default("CASH"),
});
export type BillPaymentInput = z.input<typeof billPaymentSchema>;
export type BillPaymentData = z.output<typeof billPaymentSchema>;

// ---- Calls (new-customer enquiries) ----

const isPhoneDigits = (digits: string) => /^\d{10,15}$/.test(digits);

/**
 * Pulls phone numbers out of pasted text: one per line, or separated by commas.
 * Within a line, space-separated chunks are joined until they make a number, so
 * "+91 98765 43210" stays one number and "9876543210 9876543211" becomes two.
 */
export function splitPhoneNumbers(text: string): { numbers: string[]; invalid: string[] } {
  const numbers: string[] = [];
  const invalid: string[] = [];
  for (const piece of text.split(/[\n,;]+/)) {
    let current: string[] = [];
    let digits = "";
    for (const token of piece.trim().split(/\s+/)) {
      const d = token.replace(/\D/g, "");
      if (!d) continue; // words such as "Name:" around a pasted number
      current.push(token);
      digits += d;
      if (digits.length >= 10) {
        (isPhoneDigits(digits) ? numbers : invalid).push(current.join(" "));
        current = [];
        digits = "";
      }
    }
    if (current.length) invalid.push(current.join(" "));
  }
  return { numbers, invalid };
}

export const addNumbersSchema = z
  .object({ numbers: z.string().max(5000, "That is too much text at once.") })
  .transform((v, ctx) => {
    const out = splitPhoneNumbers(v.numbers);
    if (!out.numbers.length && !out.invalid.length) {
      ctx.addIssue({ code: "custom", path: ["numbers"], message: "Enter at least one mobile number." });
      return z.NEVER;
    }
    return out;
  });
export type AddNumbersInput = z.input<typeof addNumbersSchema>;
export type AddNumbersData = z.output<typeof addNumbersSchema>;

const singlePhone = z
  .string()
  .trim()
  .min(1, "Enter the mobile number.")
  .max(25)
  .refine((v) => /^[0-9+\-\s()]+$/.test(v) && isPhoneDigits(v.replace(/\D/g, "")), "Enter a phone number with 10 to 15 digits.");

export const enquiryEditSchema = z.object({
  name: optionalText(120),
  phone: singlePhone,
  interest: optionalText(200),
});
export type EnquiryEditInput = z.input<typeof enquiryEditSchema>;
export type EnquiryEditData = z.output<typeof enquiryEditSchema>;

export const CALL_RESULTS = ["COMING", "CALL_BACK", "NO_ANSWER", "NOT_INTERESTED"] as const;

export const callLogSchema = z
  .object({
    enquiryId: z.string().min(1),
    result: z.enum(CALL_RESULTS, { message: "Pick what the customer said." }),
    /** The day they will come (COMING) or when to call again (CALL_BACK). */
    date: optionalDateInput,
    note: optionalText(300),
    name: optionalText(120),
    interest: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if (v.result === "COMING" && !v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Pick the day they will come." });
    if (v.result === "CALL_BACK" && !v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Pick when to call again." });
  });
export type CallLogInput = z.input<typeof callLogSchema>;
export type CallLogData = z.output<typeof callLogSchema>;

// ---- Attendance ----

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "HOLIDAY", "LEAVE"] as const;

export const attendanceMarkSchema = z.object({
  employeeId: z.string().min(1),
  date: requiredDateInput,
  status: z.enum(ATTENDANCE_STATUSES),
});
export type AttendanceMarkInput = z.input<typeof attendanceMarkSchema>;
export type AttendanceMarkData = z.output<typeof attendanceMarkSchema>;
