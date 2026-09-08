import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { MovementType } from "@/generated/prisma/enums";
import { AppError, InsufficientStockError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/services/settings";
import {
  movementInclude,
  productInclude,
  toMovementDTO,
  toProductDTO,
  type MovementDTO,
  type ProductDTO,
} from "@/lib/services/products";
import { PAGE_SIZE } from "@/lib/constants";

export type StockChangeResult = { product: ProductDTO; movement: MovementDTO };

async function loadResult(productId: string, movementId: string): Promise<StockChangeResult> {
  const [settings, product, movement] = await Promise.all([
    getSettings(),
    prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude }),
    prisma.stockMovement.findUniqueOrThrow({ where: { id: movementId }, include: movementInclude }),
  ]);
  return { product: toProductDTO(product, settings.lowStockThreshold), movement: toMovementDTO(movement) };
}

/**
 * Locks the product row for the duration of the transaction so concurrent
 * changes are serialised and every movement records accurate before/after values.
 */
export async function lockProduct(tx: Prisma.TransactionClient, productId: string) {
  const rows = await tx.$queryRaw<{ id: string; quantity: number; status: string; name: string }[]>`
    SELECT id, quantity, status, name FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError("Product not found.", "NOT_FOUND");
  return row;
}

/** RULE: every stock change goes through this and produces exactly one StockMovement. */
export async function applyChange(
  tx: Prisma.TransactionClient,
  args: {
    productId: string;
    type: MovementType;
    newQuantity: number;
    previousQuantity: number;
    unitCost?: string | null;
    note?: string | null;
    actorId: string;
  },
) {
  if (args.newQuantity < 0) throw new AppError("Stock cannot become negative.");
  await tx.product.update({
    where: { id: args.productId },
    data: { quantity: args.newQuantity, updatedById: args.actorId },
  });
  return tx.stockMovement.create({
    data: {
      productId: args.productId,
      type: args.type,
      quantityChange: args.newQuantity - args.previousQuantity,
      previousQuantity: args.previousQuantity,
      newQuantity: args.newQuantity,
      unitCost: args.unitCost ?? null,
      note: args.note ?? null,
      performedById: args.actorId,
    },
  });
}

/** + ADD STOCK: new material arrived. */
export async function recordStockIn(
  input: { productId: string; quantity: number; unitCost?: string | null; note?: string | null },
  actor: SessionUser,
): Promise<StockChangeResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new AppError("Quantity must be at least 1.");
  const movement = await prisma.$transaction(async (tx) => {
    const current = await lockProduct(tx, input.productId);
    return applyChange(tx, {
      productId: current.id,
      type: "STOCK_IN",
      previousQuantity: current.quantity,
      newQuantity: current.quantity + input.quantity,
      unitCost: input.unitCost,
      note: input.note ?? "New stock received",
      actorId: actor.id,
    });
  });
  return loadResult(input.productId, movement.id);
}

/**
 * - SELL / REDUCE STOCK.
 * The availability check happens inside the transaction on a locked row, so two
 * simultaneous sales of the last unit cannot both succeed.
 */
export async function recordSale(
  input: { productId: string; quantity: number; note?: string | null },
  actor: SessionUser,
): Promise<StockChangeResult> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new AppError("Quantity must be at least 1.");
  const movement = await prisma.$transaction(async (tx) => {
    const current = await lockProduct(tx, input.productId);
    if (current.status !== "ACTIVE") throw new AppError("This product is archived and cannot be sold.");
    if (current.quantity < input.quantity) throw new InsufficientStockError(current.quantity);
    return applyChange(tx, {
      productId: current.id,
      type: "SALE",
      previousQuantity: current.quantity,
      newQuantity: current.quantity - input.quantity,
      note: input.note ?? "Sold",
      actorId: actor.id,
    });
  });
  return loadResult(input.productId, movement.id);
}

/** ADJUST STOCK: set to a physically counted quantity; never silently overwrites. */
export async function adjustStock(
  input: { productId: string; newQuantity: number; reason: string },
  actor: SessionUser,
): Promise<StockChangeResult> {
  if (!Number.isInteger(input.newQuantity) || input.newQuantity < 0) {
    throw new AppError("New quantity must be zero or more.");
  }
  const movement = await prisma.$transaction(async (tx) => {
    const current = await lockProduct(tx, input.productId);
    if (current.quantity === input.newQuantity) {
      throw new AppError(`Stock is already ${current.quantity}. Nothing to adjust.`);
    }
    return applyChange(tx, {
      productId: current.id,
      type: "ADJUSTMENT",
      previousQuantity: current.quantity,
      newQuantity: input.newQuantity,
      note: input.reason,
      actorId: actor.id,
    });
  });
  return loadResult(input.productId, movement.id);
}

/* ---------- History ---------- */

export type ListMovementsParams = {
  productId?: string;
  type?: MovementType;
  page?: number;
  pageSize?: number;
};

export async function listMovements(params: ListMovementsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const where: Prisma.StockMovementWhereInput = {};
  if (params.productId) where.productId = params.productId;
  if (params.type) where.type = params.type;
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: movementInclude,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return { items: rows.map(toMovementDTO), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/* ---------- Dashboard ---------- */

export type DashboardStats = {
  totalProducts: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const settings = await getSettings();
  const t = settings.lowStockThreshold;
  const rows = await prisma.$queryRaw<
    { total_products: bigint; total_units: bigint | null; low: bigint; out: bigint }[]
  >`
    SELECT
      COUNT(*)                                                                  AS total_products,
      COALESCE(SUM(quantity), 0)                                                AS total_units,
      COUNT(*) FILTER (WHERE quantity >= 1 AND quantity <= COALESCE("lowStockThreshold", ${t})) AS low,
      COUNT(*) FILTER (WHERE quantity <= 0)                                     AS out
    FROM "Product"
    WHERE status = 'ACTIVE'`;
  const r = rows[0];
  return {
    totalProducts: Number(r?.total_products ?? 0),
    totalUnits: Number(r?.total_units ?? 0),
    lowStockCount: Number(r?.low ?? 0),
    outOfStockCount: Number(r?.out ?? 0),
  };
}
