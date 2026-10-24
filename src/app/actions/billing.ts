"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  billCancelSchema,
  billCreateSchema,
  billPaymentSchema,
  billUpdateSchema,
  fieldErrors,
  openBillSchema,
  serviceSchema,
  type BillCreateInput,
  type BillPaymentInput,
  type BillUpdateInput,
  type OpenBillInput,
  type ServiceInput,
} from "@/lib/validation/schemas";
import { discardOpenBill, saveOpenBill, type OpenBillDTO } from "@/lib/services/open-bills";
import { getCustomerHistory, searchCustomers, type CustomerHistoryDTO, type CustomerSuggestionDTO } from "@/lib/services/customers";
import { getCalledLead, type CalledLeadDTO } from "@/lib/services/enquiries";
import { phoneKey } from "@/lib/phone";
import {
  addBillPayment,
  cancelBill,
  createBill,
  createService,
  deleteBillPayment,
  getOrCreateShareLink,
  listServices,
  turnOffShareLink,
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

export async function saveOpenBillAction(input: OpenBillInput): Promise<ActionResult<OpenBillDTO>> {
  try {
    const user = await requirePermission("bill.create");
    const parsed = openBillSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: first?.message ?? "Please check the bill details.", fieldErrors: fieldErrors(parsed.error) };
    }
    const openBill = await saveOpenBill(parsed.data, user);
    revalidatePath("/billing");
    return { ok: true, data: openBill };
  } catch (err) {
    return toActionError(err);
  }
}

export async function discardOpenBillAction(openBillId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("bill.create");
    await discardOpenBill(openBillId, user);
    revalidatePath("/billing");
    revalidatePath("/settings");
    return { ok: true, data: undefined };
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

/** Where the app is being used from, so the bill link opens the same site (e.g. https://salon-inventory-three.vercel.app). */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return (process.env.APP_URL ?? "").replace(/\/$/, "");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function shareBillAction(billId: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  try {
    const user = await requirePermission("bill.view");
    const link = await getOrCreateShareLink(billId, user);
    revalidatePath(`/billing/${billId}`);
    revalidatePath("/activity");
    return { ok: true, data: { url: `${await siteOrigin()}/b/${link.token}`, expiresAt: link.expiresAt } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function turnOffShareLinkAction(billId: string): Promise<ActionResult<null>> {
  try {
    const user = await requirePermission("bill.cancel");
    await turnOffShareLink(billId, user);
    revalidatePath(`/billing/${billId}`);
    revalidatePath("/activity");
    return { ok: true, data: null };
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

export async function searchCustomersAction(query: string): Promise<ActionResult<CustomerSuggestionDTO[]>> {
  try {
    await requirePermission("bill.create");
    return { ok: true, data: await searchCustomers(String(query ?? "").slice(0, 120)) };
  } catch (err) {
    return toActionError(err);
  }
}

/** Who the typed number belongs to: past visits, and the call lead they came from (if any). */
export async function customerHistoryAction(phone: string): Promise<ActionResult<{ history: CustomerHistoryDTO; calledLead: CalledLeadDTO | null } | null>> {
  try {
    await requirePermission("bill.create");
    const key = phoneKey(String(phone ?? ""));
    if (!key) return { ok: true, data: null };
    const [history, calledLead] = await Promise.all([getCustomerHistory(key), getCalledLead(key)]);
    return { ok: true, data: { history, calledLead } };
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
