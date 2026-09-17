"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { adjustmentSchema, fieldErrors, saleSchema, stockInSchema } from "@/lib/validation/schemas";
import { adjustStock, recordSale, recordStockIn, type StockChangeResult } from "@/lib/services/inventory";
import { movementForViewer, productForViewer } from "@/lib/services/products";
import type { Role } from "@/generated/prisma/enums";

function revalidateInventory(productId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  revalidatePath("/inventory/low-stock");
  revalidatePath("/inventory/out-of-stock");
  revalidatePath("/activity");
  revalidatePath("/pricing");
  revalidatePath(`/inventory/${productId}`);
}

function resultForViewer(result: StockChangeResult, role: Role): StockChangeResult {
  return { product: productForViewer(result.product, role), movement: movementForViewer(result.movement, role) };
}

export type StockInInput = { productId: string; quantity: number | string; unitCost?: string; note?: string };
export type SaleInput = { productId: string; quantity: number | string; note?: string };
export type AdjustmentInput = { productId: string; newQuantity: number | string; reason: string };

export async function stockInAction(input: StockInInput): Promise<ActionResult<StockChangeResult>> {
  try {
    const user = await requirePermission("stock.in");
    const parsed = stockInSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    // Purchase price is owner-only information; managers cannot record it.
    const result = await recordStockIn(user.role === "OWNER" ? parsed.data : { ...parsed.data, unitCost: null }, user);
    revalidateInventory(result.product.id);
    return { ok: true, data: resultForViewer(result, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saleAction(input: SaleInput): Promise<ActionResult<StockChangeResult>> {
  try {
    const user = await requirePermission("stock.sale");
    const parsed = saleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const result = await recordSale(parsed.data, user);
    revalidateInventory(result.product.id);
    return { ok: true, data: resultForViewer(result, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function adjustStockAction(input: AdjustmentInput): Promise<ActionResult<StockChangeResult>> {
  try {
    const user = await requirePermission("stock.adjust");
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const result = await adjustStock(parsed.data, user);
    revalidateInventory(result.product.id);
    return { ok: true, data: resultForViewer(result, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}
