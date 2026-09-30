"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  billCancelSchema,
  billCreateSchema,
  billPaymentSchema,
  billUpdateSchema,
  fieldErrors,
  serviceSchema,
  type BillCreateInput,
  type BillPaymentInput,
  type BillUpdateInput,
  type ServiceInput,
} from "@/lib/validation/schemas";
import {
  addBillPayment,
  cancelBill,
  createBill,
  createService,
  deleteBillPayment,
  listServices,
  updateBill,
  updateService,
  type BillDTO,
  type ServiceDTO,
} from "@/lib/services/billing";

function revalidateBilling(billId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/billing");
  revalidatePath("/reports");
  revalidatePath("/inventory");
  revalidatePath("/activity");
  if (billId) revalidatePath(`/billing/${billId}`);
}

export async function createBillAction(input: BillCreateInput): Promise<ActionResult<BillDTO>> {
  try {
    const user = await requirePermission("bill.create");
    const parsed = billCreateSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: first?.message ?? "Please check the bill details.", fieldErrors: fieldErrors(parsed.error) };
    }
    const bill = await createBill(parsed.data, user);
    revalidateBilling(bill.id);
    return { ok: true, data: bill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateBillAction(input: BillUpdateInput): Promise<ActionResult<BillDTO>> {
  try {
    const user = await requirePermission("bill.edit");
    const parsed = billUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: first?.message ?? "Please check the bill details.", fieldErrors: fieldErrors(parsed.error) };
    }
    const bill = await updateBill(parsed.data, user);
    revalidateBilling(bill.id);
    return { ok: true, data: bill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelBillAction(input: { billId: string; reason: string }): Promise<ActionResult<BillDTO>> {
  try {
    const user = await requirePermission("bill.cancel");
    const parsed = billCancelSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const bill = await cancelBill(parsed.data, user);
    revalidateBilling(bill.id);
    return { ok: true, data: bill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addBillPaymentAction(input: BillPaymentInput): Promise<ActionResult<BillDTO>> {
  try {
    const user = await requirePermission("bill.collect");
    const parsed = billPaymentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const bill = await addBillPayment(parsed.data, user);
    revalidateBilling(bill.id);
    return { ok: true, data: bill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteBillPaymentAction(paymentId: string): Promise<ActionResult<BillDTO>> {
  try {
    const user = await requirePermission("bill.collect");
    const bill = await deleteBillPayment(paymentId, user);
    revalidateBilling(bill.id);
    return { ok: true, data: bill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function listActiveServicesAction(): Promise<ActionResult<ServiceDTO[]>> {
  try {
    await requirePermission("bill.create");
    return { ok: true, data: await listServices({ activeOnly: true }) };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createServiceAction(input: ServiceInput): Promise<ActionResult<ServiceDTO>> {
  try {
    const user = await requirePermission("service.manage");
    const parsed = serviceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const service = await createService(parsed.data, user);
    revalidatePath("/settings");
    revalidatePath("/billing/new");
    return { ok: true, data: service };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateServiceAction(
  id: string,
  input: { name?: string; price?: string; isActive?: boolean },
): Promise<ActionResult<ServiceDTO>> {
  try {
    const user = await requirePermission("service.manage");
    const patch: { name?: string; price?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.price !== undefined) patch.price = input.price;
    const parsed = serviceSchema.partial().safeParse(patch);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const service = await updateService(id, { ...parsed.data, isActive: input.isActive }, user);
    revalidatePath("/settings");
    revalidatePath("/billing/new");
    return { ok: true, data: service };
  } catch (err) {
    return toActionError(err);
  }
}
