"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  fieldErrors,
  orderCloseSchema,
  orderCreateSchema,
  orderReceiveSchema,
  type OrderCreateInput,
  type OrderReceiveInput,
} from "@/lib/validation/schemas";
import { closeOrder, createOrder, orderForViewer, receiveOrder, updateOrder, type OrderDTO } from "@/lib/services/orders";
import { listProducts, productsForViewer, type ProductDTO } from "@/lib/services/products";

function revalidateOrders(orderId?: string) {
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/inventory", "layout");
  revalidatePath("/activity");
  revalidatePath("/pricing");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function createOrderAction(input: OrderCreateInput): Promise<ActionResult<OrderDTO>> {
  try {
    const user = await requirePermission("order.create");
    const parsed = orderCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the order.", fieldErrors: fieldErrors(parsed.error) };
    }
    const order = await createOrder(parsed.data, user);
    revalidateOrders(order.id);
    return { ok: true, data: orderForViewer(order, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateOrderAction(orderId: string, input: OrderCreateInput): Promise<ActionResult<OrderDTO>> {
  try {
    const user = await requirePermission("order.manage");
    const parsed = orderCreateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the order.", fieldErrors: fieldErrors(parsed.error) };
    }
    const order = await updateOrder(orderId, parsed.data, user);
    revalidateOrders(order.id);
    return { ok: true, data: order };
  } catch (err) {
    return toActionError(err);
  }
}

export async function receiveOrderAction(input: OrderReceiveInput): Promise<ActionResult<OrderDTO>> {
  try {
    const user = await requirePermission("order.receive");
    const parsed = orderReceiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the quantities." };
    const order = await receiveOrder(parsed.data, user);
    revalidateOrders(order.id);
    return { ok: true, data: orderForViewer(order, user.role) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function closeOrderAction(input: { orderId: string; reason: string }): Promise<ActionResult<OrderDTO>> {
  try {
    const user = await requirePermission("order.manage");
    const parsed = orderCloseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const order = await closeOrder(parsed.data, user);
    revalidateOrders(order.id);
    return { ok: true, data: order };
  } catch (err) {
    return toActionError(err);
  }
}

const STOCK_RANK = { OUT_OF_STOCK: 0, LOW_STOCK: 1, IN_STOCK: 2 } as const;

/**
 * Product picker for a new order: what most needs reordering comes first —
 * out of stock, then low stock, then in stock. With no search text it shows
 * the top of each group; with a search it ranks the matches the same way.
 */
export async function orderPickerProductsAction(query: string): Promise<ActionResult<ProductDTO[]>> {
  try {
    const user = await requirePermission("order.create");
    const search = query.trim();
    if (search) {
      const { items } = await listProducts({ search, pageSize: 30 });
      // A scanned barcode / exact SKU still lands on top, whatever its stock.
      const lower = search.toLowerCase();
      const rank = (p: ProductDTO) => (p.barcode === search || p.sku?.toLowerCase() === lower ? -1 : STOCK_RANK[p.stockStatus]);
      return { ok: true, data: productsForViewer([...items].sort((a, b) => rank(a) - rank(b)), user.role) };
    }
    const [out, low, inStock] = await Promise.all([
      listProducts({ stockStatus: "OUT_OF_STOCK", sort: "name", pageSize: 30 }),
      listProducts({ stockStatus: "LOW_STOCK", sort: "quantity", pageSize: 30 }),
      listProducts({ stockStatus: "IN_STOCK", sort: "name", pageSize: 30 }),
    ]);
    return { ok: true, data: productsForViewer([...out.items, ...low.items, ...inStock.items], user.role) };
  } catch (err) {
    return toActionError(err);
  }
}
