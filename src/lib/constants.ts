import type { MovementType, Unit } from "@/generated/prisma/enums";

export const UNITS: { value: Unit; label: string }[] = [
  { value: "PIECE", label: "Piece" },
  { value: "PACK", label: "Pack" },
  { value: "BOX", label: "Box" },
  { value: "BOTTLE", label: "Bottle" },
  { value: "ROLL", label: "Roll" },
  { value: "SET", label: "Set" },
  { value: "PAIR", label: "Pair" },
  { value: "METER", label: "Meter" },
];

export const UNIT_LABEL = Object.fromEntries(UNITS.map((u) => [u.value, u.label])) as Record<Unit, string>;

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  INITIAL_STOCK: "Initial stock",
  STOCK_IN: "Stock in",
  SALE: "Sale",
  ADJUSTMENT: "Adjustment",
  BILL_CANCELLED: "Bill cancelled",
};

/**
 * A manual reduction from the inventory page and a product sold on a bill both
 * write MovementType.SALE, but only the billed one earns money. The two are told
 * apart by `billId`, so the history never calls a shelf write-off a "Sale".
 */
export const MANUAL_REDUCTION_LABEL = "Reduce stock";

export function movementLabel(type: MovementType, billId: string | null): string {
  return type === "SALE" && billId === null ? MANUAL_REDUCTION_LABEL : MOVEMENT_LABEL[type];
}

/** The activity filter queries by MovementType, so its SALE option covers both. */
export const MOVEMENT_FILTER_LABEL: Record<MovementType, string> = {
  ...MOVEMENT_LABEL,
  SALE: "Sale / reduce stock",
};

export const SESSION_COOKIE = "salon_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const PAGE_SIZE = 25;

/* ---------- Employees ---------- */

export const EMPLOYEE_DOC_MAX_BYTES = 4 * 1024 * 1024; // 4 MB per file
export const EMPLOYEE_DOC_MAX_COUNT = 5; // per employee
export const EMPLOYEE_DOC_MIME: readonly string[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export const EMPLOYEE_DOC_KIND_LABEL: Record<"AADHAAR_FRONT" | "AADHAAR_BACK" | "OTHER", string> = {
  AADHAAR_FRONT: "Aadhaar card (front)",
  AADHAAR_BACK: "Aadhaar card (back)",
  OTHER: "Other document",
};
