"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { advanceSchema, fieldErrors, type AdvanceInput } from "@/lib/validation/schemas";
import { advanceTotalForMonth, deleteAdvance, recordAdvance, type AdvanceDTO } from "@/lib/services/advances";
import { isMonthParam } from "@/lib/dates";

function revalidateEmployee(employeeId: string) {
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
}

export async function recordAdvanceAction(input: AdvanceInput): Promise<ActionResult<AdvanceDTO>> {
  try {
    const user = await requirePermission("advance.record");
    const parsed = advanceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const advance = await recordAdvance(parsed.data, user);
    revalidateEmployee(advance.employeeId);
    return { ok: true, data: advance };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteAdvanceAction(advanceId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("advance.record");
    const { employeeId } = await deleteAdvance(advanceId, user);
    revalidateEmployee(employeeId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner: advances taken in a month, to deduct from that month's salary. */
export async function advanceTotalAction(employeeId: string, month: string): Promise<ActionResult<string>> {
  try {
    const user = await requirePermission("employee.manage");
    if (!isMonthParam(month)) return { ok: false, error: "Choose a month." };
    return { ok: true, data: await advanceTotalForMonth(employeeId, month, user) };
  } catch (err) {
    return toActionError(err);
  }
}
