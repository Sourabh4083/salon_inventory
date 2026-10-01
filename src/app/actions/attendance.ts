"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { attendanceMarkSchema, type AttendanceMarkInput } from "@/lib/validation/schemas";
import { absenceCutForMonth, decideLeave, markAllPresent, markAttendance } from "@/lib/services/attendance";
import { isMonthParam, parseDateParam } from "@/lib/dates";

function revalidateAttendance() {
  revalidatePath("/attendance");
  revalidatePath("/employees", "layout");
}

export async function markAttendanceAction(input: AttendanceMarkInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("attendance.mark");
    const parsed = attendanceMarkSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Pick a day and what to mark." };
    await markAttendance(parsed.data, user);
    revalidateAttendance();
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markAllPresentAction(date: string): Promise<ActionResult<number>> {
  try {
    const user = await requirePermission("attendance.mark");
    const day = parseDateParam(date);
    if (!day) return { ok: false, error: "Pick a day." };
    const count = await markAllPresent(day, user);
    revalidateAttendance();
    return { ok: true, data: count };
  } catch (err) {
    return toActionError(err);
  }
}

export async function decideLeaveAction(attendanceId: string, paid: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("employee.manage");
    await decideLeave(attendanceId, paid, user);
    revalidateAttendance();
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner: the month's attendance pay cut, to pre-fill the salary payment. */
export async function absenceCutAction(employeeId: string, month: string): Promise<ActionResult<{ cutDays: number; deduction: string }>> {
  try {
    const user = await requirePermission("employee.manage");
    if (!isMonthParam(month)) return { ok: false, error: "Choose a month." };
    return { ok: true, data: await absenceCutForMonth(employeeId, month, user) };
  } catch (err) {
    return toActionError(err);
  }
}
