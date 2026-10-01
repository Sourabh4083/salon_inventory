"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { addNumbersSchema, callLogSchema, enquiryEditSchema, fieldErrors, type AddNumbersInput, type CallLogInput, type EnquiryEditInput } from "@/lib/validation/schemas";
import { addNumbers, logCall, markVisited, updateEnquiry, type AddNumbersResult, type EnquiryDTO } from "@/lib/services/enquiries";

const INVALID = "Please fix the highlighted fields.";

export async function addNumbersAction(input: AddNumbersInput): Promise<ActionResult<AddNumbersResult>> {
  try {
    const user = await requirePermission("enquiry.manage");
    const parsed = addNumbersSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const result = await addNumbers(parsed.data, user);
    revalidatePath("/calls");
    return { ok: true, data: result };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateEnquiryAction(id: string, input: EnquiryEditInput): Promise<ActionResult<EnquiryDTO>> {
  try {
    const user = await requirePermission("enquiry.manage");
    const parsed = enquiryEditSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const enquiry = await updateEnquiry(id, parsed.data, user);
    revalidatePath("/calls");
    return { ok: true, data: enquiry };
  } catch (err) {
    return toActionError(err);
  }
}

export async function logCallAction(input: CallLogInput): Promise<ActionResult<EnquiryDTO>> {
  try {
    const user = await requirePermission("enquiry.manage");
    const parsed = callLogSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const enquiry = await logCall(parsed.data, user);
    revalidatePath("/calls");
    return { ok: true, data: enquiry };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markVisitedAction(id: string): Promise<ActionResult<EnquiryDTO>> {
  try {
    const user = await requirePermission("enquiry.manage");
    const enquiry = await markVisited(id, user);
    revalidatePath("/calls");
    return { ok: true, data: enquiry };
  } catch (err) {
    return toActionError(err);
  }
}
