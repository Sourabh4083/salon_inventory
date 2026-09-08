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

export const SESSION_COOKIE = "salon_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const PAGE_SIZE = 25;
