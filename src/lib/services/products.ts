import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { MovementType, ProductStatus, Unit } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { getSettings } from "@/lib/services/settings";
import { recordAudit } from "@/lib/services/audit";
import { effectiveThreshold, getStockStatus, type StockStatus } from "@/lib/stock-status";
import { MANAGER_EDITABLE_PRODUCT_FIELDS } from "@/lib/permissions";
import { PAGE_SIZE } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";
import type { z } from "zod";
import type { productCreateSchema, productUpdateSchema } from "@/lib/validation/schemas";

/* ---------- DTOs (serialisable for client components) ---------- */

export type ProductDTO = {
  id: string;
  productNumber: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string;
  categoryName: string;
  description: string | null;
  costPrice: string | null;
  sellingPrice: string | null;
  quantity: number;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
  stockStatus: StockStatus;
  unit: Unit;
  location: string | null;
  notes: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
};

export type MovementDTO = {
  id: string;
  productId: string;
  productName: string;
  productNumber: string;
  type: MovementType;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  unitCost: string | null;
  note: string | null;
  performedById: string;
  performedByName: string;
  performedByRole: string;
  createdAt: string;
};

export const productInclude = {
  category: { select: { name: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function toProductDTO(p: ProductRow, globalThreshold: number): ProductDTO {
  const threshold = effectiveThreshold(p.lowStockThreshold, globalThreshold);
  return {
    id: p.id,
    productNumber: p.productNumber,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    description: p.description,
    costPrice: p.costPrice ? p.costPrice.toString() : null,
    sellingPrice: p.sellingPrice ? p.sellingPrice.toString() : null,
    quantity: p.quantity,
    lowStockThreshold: p.lowStockThreshold,
    effectiveThreshold: threshold,
    stockStatus: getStockStatus(p.quantity, threshold),
    unit: p.unit,
    location: p.location,
    notes: p.notes,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    createdByName: p.createdBy?.name ?? null,
    updatedByName: p.updatedBy?.name ?? null,
  };
}

export const movementInclude = {
  product: { select: { name: true, productNumber: true } },
  performedBy: { select: { name: true, role: true } },
} satisfies Prisma.StockMovementInclude;

type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

export function toMovementDTO(m: MovementRow): MovementDTO {
  return {
    id: m.id,
    productId: m.productId,
    productName: m.product.name,
    productNumber: m.product.productNumber,
    type: m.type,
    quantityChange: m.quantityChange,
    previousQuantity: m.previousQuantity,
    newQuantity: m.newQuantity,
    unitCost: m.unitCost ? m.unitCost.toString() : null,
    note: m.note,
    performedById: m.performedById,
    performedByName: m.performedBy.name,
    performedByRole: m.performedBy.role,
    createdAt: m.createdAt.toISOString(),
  };
}

/* ---------- Helpers ---------- */

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function uniqueError(err: Prisma.PrismaClientKnownRequestError): AppError {
  // Depending on the driver adapter, the violated columns are in meta.target or the constraint name.
  const t = JSON.stringify(err.meta ?? {}) + (err.message ?? "");
  if (t.includes("barcode")) return new AppError("This barcode is already used by another product.", "CONFLICT");
  if (t.includes("sku")) return new AppError("This SKU is already used by another product.", "CONFLICT");
  return new AppError("A product with these details already exists.", "CONFLICT");
}

async function nextProductNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_number_seq') AS n`;
  const n = Number(rows[0].n);
  return `PRD-${String(n).padStart(6, "0")}`;
}

/** Ids of active products that are LOW (1..threshold) or OUT (0), honouring per-product overrides. */
async function idsByStockStatus(status: StockStatus, globalThreshold: number): Promise<string[]> {
  let rows: { id: string }[];
  if (status === "OUT_OF_STOCK") {
    rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE status = 'ACTIVE' AND quantity <= 0`;
  } else if (status === "LOW_STOCK") {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE status = 'ACTIVE' AND quantity >= 1 AND quantity <= COALESCE("lowStockThreshold", ${globalThreshold})`;
  } else {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE status = 'ACTIVE' AND quantity > COALESCE("lowStockThreshold", ${globalThreshold})`;
  }
  return rows.map((r) => r.id);
}

/* ---------- Queries ---------- */

export type ProductSort = "name" | "quantity" | "price" | "updated";

export type ListProductsParams = {
  search?: string;
  categoryId?: string;
  stockStatus?: StockStatus;
  sort?: ProductSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  archivedOnly?: boolean;
};

export async function listProducts(params: ListProductsParams = {}) {
  const settings = await getSettings();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const search = params.search?.trim() ?? "";

  const where: Prisma.ProductWhereInput = {};
  if (params.archivedOnly) where.status = "ARCHIVED";
  else if (!params.includeArchived) where.status = "ACTIVE";
  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.stockStatus) where.id = { in: await idsByStockStatus(params.stockStatus, settings.lowStockThreshold) };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search } },
      { productNumber: { contains: search, mode: "insensitive" } },
    ];
  }

  const dir = params.dir ?? (params.sort === "updated" ? "desc" : "asc");
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    params.sort === "quantity"
      ? [{ quantity: dir }, { name: "asc" }]
      : params.sort === "price"
        ? [{ sellingPrice: { sort: dir, nulls: "last" } }, { name: "asc" }]
        : params.sort === "updated"
          ? [{ updatedAt: dir }]
          : [{ name: dir }];

  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy, include: productInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.product.count({ where }),
  ]);

  let items = rows.map((p) => toProductDTO(p, settings.lowStockThreshold));

  // Exact barcode / SKU match always floats to the top so scanner input lands on the right product.
  if (search) {
    const lower = search.toLowerCase();
    items = [...items].sort((a, b) => {
      const ea = a.barcode === search || a.sku?.toLowerCase() === lower ? 0 : 1;
      const eb = b.barcode === search || b.sku?.toLowerCase() === lower ? 0 : 1;
      return ea - eb;
    });
  }

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getProduct(id: string): Promise<ProductDTO | null> {
  const [settings, row] = await Promise.all([
    getSettings(),
    prisma.product.findUnique({ where: { id }, include: productInclude }),
  ]);
  return row ? toProductDTO(row, settings.lowStockThreshold) : null;
}

/** Exact barcode lookup (used by scanner). Also accepts SKU or product number as a fallback. */
export async function findProductByCode(code: string): Promise<ProductDTO | null> {
  const value = code.trim();
  if (!value) return null;
  const settings = await getSettings();
  const row =
    (await prisma.product.findFirst({ where: { barcode: value }, include: productInclude })) ??
    (await prisma.product.findFirst({
      where: { OR: [{ sku: { equals: value, mode: "insensitive" } }, { productNumber: { equals: value, mode: "insensitive" } }] },
      include: productInclude,
    }));
  return row ? toProductDTO(row, settings.lowStockThreshold) : null;
}

export async function listCategories() {
  return prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
}

/* ---------- Mutations ---------- */

type CreateInput = z.output<typeof productCreateSchema>;
type UpdateInput = z.output<typeof productUpdateSchema>;

export async function createProduct(input: CreateInput, actor: SessionUser): Promise<ProductDTO> {
  const settings = await getSettings();
  try {
    const created = await prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppError("Selected category does not exist.");
      const productNumber = await nextProductNumber(tx);
      const product = await tx.product.create({
        data: {
          productNumber,
          name: input.name,
          categoryId: input.categoryId,
          sku: input.sku,
          barcode: input.barcode,
          description: input.description,
          costPrice: input.costPrice,
          sellingPrice: input.sellingPrice,
          quantity: input.startingQuantity,
          lowStockThreshold: input.lowStockThreshold,
          unit: input.unit,
          location: input.location,
          notes: input.notes,
          createdById: actor.id,
          updatedById: actor.id,
        },
        include: productInclude,
      });
      if (input.startingQuantity > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "INITIAL_STOCK",
            quantityChange: input.startingQuantity,
            previousQuantity: 0,
            newQuantity: input.startingQuantity,
            unitCost: input.costPrice,
            note: "Starting quantity",
            performedById: actor.id,
          },
        });
      }
      await recordAudit(tx, {
        action: "PRODUCT_CREATED",
        entityType: "Product",
        entityId: product.id,
        summary: `Created product ${product.productNumber} "${product.name}" with starting quantity ${input.startingQuantity}`,
        actorId: actor.id,
      });
      return product;
    });
    return toProductDTO(created, settings.lowStockThreshold);
  } catch (err) {
    if (isUniqueViolation(err)) throw uniqueError(err);
    throw err;
  }
}

export async function updateProduct(id: string, input: UpdateInput, actor: SessionUser): Promise<ProductDTO> {
  const settings = await getSettings();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
      if (existing.status === "ARCHIVED" && actor.role !== "OWNER") {
        throw new AppError("Archived products can only be edited by the owner.", "FORBIDDEN");
      }

      const data: Prisma.ProductUncheckedUpdateInput = {
        name: input.name,
        categoryId: input.categoryId,
        sku: input.sku,
        barcode: input.barcode,
        description: input.description,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
        unit: input.unit,
        location: input.location,
        notes: input.notes,
        lowStockThreshold: input.lowStockThreshold,
        updatedById: actor.id,
      };

      // Managers may only edit basic product information.
      if (actor.role !== "OWNER") {
        for (const key of Object.keys(data)) {
          if (key !== "updatedById" && !MANAGER_EDITABLE_PRODUCT_FIELDS.has(key)) {
            delete (data as Record<string, unknown>)[key];
          }
        }
      }

      const changed: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        if (key === "updatedById") continue;
        const before = existing[key as keyof typeof existing];
        const beforeStr = before instanceof Prisma.Decimal ? before.toString() : (before ?? null);
        const afterStr = value ?? null;
        if (String(beforeStr ?? "") !== String(afterStr ?? "")) changed.push(key);
      }

      const product = await tx.product.update({ where: { id }, data, include: productInclude });
      await recordAudit(tx, {
        action: "PRODUCT_UPDATED",
        entityType: "Product",
        entityId: id,
        summary: `Edited product ${product.productNumber} "${product.name}"${changed.length ? ` (${changed.join(", ")})` : ""}`,
        metadata: { changedFields: changed },
        actorId: actor.id,
      });
      return product;
    });
    return toProductDTO(updated, settings.lowStockThreshold);
  } catch (err) {
    if (isUniqueViolation(err)) throw uniqueError(err);
    throw err;
  }
}

export async function setProductStatus(id: string, status: ProductStatus, actor: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
    const product = await tx.product.update({ where: { id }, data: { status, updatedById: actor.id } });
    await recordAudit(tx, {
      action: status === "ARCHIVED" ? "PRODUCT_ARCHIVED" : "PRODUCT_RESTORED",
      entityType: "Product",
      entityId: id,
      summary: `${status === "ARCHIVED" ? "Archived" : "Restored"} product ${product.productNumber} "${product.name}"`,
      actorId: actor.id,
    });
    return product;
  });
}

/**
 * Permanently deletes a product and its stock movements (owner only).
 * The audit log keeps a record of the deletion, including a snapshot of the product.
 */
export async function deleteProduct(id: string, actor: SessionUser) {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can delete products.", "FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id }, include: { category: true } });
    if (!existing) throw new AppError("Product not found.", "NOT_FOUND");
    const movementCount = await tx.stockMovement.count({ where: { productId: id } });
    await tx.stockMovement.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
    await recordAudit(tx, {
      action: "PRODUCT_DELETED",
      entityType: "Product",
      entityId: id,
      summary: `Deleted product ${existing.productNumber} "${existing.name}" (quantity ${existing.quantity}, ${movementCount} stock movements removed)`,
      actorId: actor.id,
      metadata: {
        productNumber: existing.productNumber,
        name: existing.name,
        sku: existing.sku,
        barcode: existing.barcode,
        category: existing.category.name,
        quantity: existing.quantity,
        status: existing.status,
        movementCount,
      },
    });
    return { productNumber: existing.productNumber, name: existing.name };
  });
}

export async function createCategory(name: string, actor: SessionUser) {
  const existing = await prisma.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) throw new AppError("A category with this name already exists.", "CONFLICT");
  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.category.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await recordAudit(prisma, {
    action: "CATEGORY_CREATED",
    entityType: "Category",
    entityId: category.id,
    summary: `Created category "${category.name}"`,
    actorId: actor.id,
  });
  return category;
}
