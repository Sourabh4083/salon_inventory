"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  categorySchema,
  fieldErrors,
  productCreateSchema,
  productPricesSchema,
  productUpdateSchema,
  type ProductCreateInput,
  type ProductPricesInput,
  type ProductUpdateInput,
} from "@/lib/validation/schemas";
import {
  createCategory,
  createProduct,
  deleteProduct,
  findProductByCode,
  listProducts,
  productForViewer,
  productsForViewer,
  setProductStatus,
  updateProduct,
  updateProductPrices,
  type ProductDTO,
} from "@/lib/services/products";

function revalidateInventory(productId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/inventory");
  revalidatePath("/inventory/low-stock");
  revalidatePath("/inventory/out-of-stock");
  revalidatePath("/activity");
  revalidatePath("/pricing");
  if (productId) revalidatePath(`/inventory/${productId}`);
}

export async function createProductAction(input: ProductCreateInput): Promise<ActionResult<ProductDTO>> {
  try {
    const user = await requirePermission("product.create");
    const parsed = productCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const product = await createProduct(parsed.data, user);
    revalidateInventory(product.id);
    return { ok: true, data: productForViewer(product, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateProductAction(id: string, input: ProductUpdateInput): Promise<ActionResult<ProductDTO>> {
  try {
    const user = await requirePermission("product.edit");
    const parsed = productUpdateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const product = await updateProduct(id, parsed.data, user);
    revalidateInventory(product.id);
    return { ok: true, data: productForViewer(product, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner only: set cost / selling price (Prices & Margins page). */
export async function updateProductPricesAction(id: string, input: ProductPricesInput): Promise<ActionResult<ProductDTO>> {
  try {
    const user = await requirePermission("product.price.edit");
    const parsed = productPricesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const product = await updateProductPrices(id, parsed.data, user);
    revalidateInventory(product.id);
    return { ok: true, data: product };
  } catch (err) {
    return toActionError(err);
  }
}

export async function archiveProductAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("product.archive");
    await setProductStatus(id, "ARCHIVED", user);
    revalidateInventory(id);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function restoreProductAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("product.archive");
    await setProductStatus(id, "ACTIVE", user);
    revalidateInventory(id);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner only: permanently removes a product and its stock history. */
export async function deleteProductAction(id: string): Promise<ActionResult<{ productNumber: string; name: string }>> {
  try {
    const user = await requirePermission("product.delete");
    const deleted = await deleteProduct(id, user);
    revalidateInventory(id);
    return { ok: true, data: deleted };
  } catch (err) {
    return toActionError(err);
  }
}

/** Exact barcode / SKU / product-number lookup used by scanner input. */
export async function lookupProductByCodeAction(code: string): Promise<ActionResult<ProductDTO | null>> {
  try {
    const user = await requirePermission("product.view");
    const product = await findProductByCode(code);
    return { ok: true, data: product ? productForViewer(product, user.role) : null };
  } catch (err) {
    return toActionError(err);
  }
}

/** Lightweight search used by quick-action pickers (Add Stock / Record Sale from dashboard). */
export async function quickSearchProductsAction(query: string): Promise<ActionResult<ProductDTO[]>> {
  try {
    const user = await requirePermission("product.view");
    const result = await listProducts({ search: query, pageSize: 8 });
    return { ok: true, data: productsForViewer(result.items, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createCategoryAction(input: { name: string }): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await requirePermission("category.manage");
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const category = await createCategory(parsed.data.name, user);
    revalidatePath("/settings");
    revalidatePath("/inventory");
    return { ok: true, data: { id: category.id, name: category.name } };
  } catch (err) {
    return toActionError(err);
  }
}
