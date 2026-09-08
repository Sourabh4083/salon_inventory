"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { createManagerSchema, fieldErrors, resetPasswordSchema, updateManagerSchema } from "@/lib/validation/schemas";
import { createManager, resetManagerPassword, updateManager, type UserDTO } from "@/lib/services/users";

export async function createManagerAction(input: { name: string; email: string; password: string }): Promise<ActionResult<UserDTO>> {
  try {
    const user = await requirePermission("user.manage");
    const parsed = createManagerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const created = await createManager(parsed.data, user);
    revalidatePath("/users");
    return { ok: true, data: created };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateManagerAction(input: { userId: string; name: string; isActive: boolean }): Promise<ActionResult<UserDTO>> {
  try {
    const user = await requirePermission("user.manage");
    const parsed = updateManagerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    const updated = await updateManager(parsed.data, user);
    revalidatePath("/users");
    return { ok: true, data: updated };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetManagerPasswordAction(input: { userId: string; password: string }): Promise<ActionResult> {
  try {
    const user = await requirePermission("user.manage");
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    await resetManagerPassword(parsed.data, user);
    revalidatePath("/users");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
