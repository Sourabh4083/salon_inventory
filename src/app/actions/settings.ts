"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { fieldErrors, settingsSchema } from "@/lib/validation/schemas";
import { updateSettings, type BusinessSettingsData } from "@/lib/services/settings";

export async function updateSettingsAction(input: {
  businessName: string;
  currencyCode: string;
  currencySymbol: string;
  lowStockThreshold: number | string;
}): Promise<ActionResult<BusinessSettingsData>> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    await updateSettings(parsed.data, user.id);
    revalidatePath("/", "layout");
    return { ok: true, data: parsed.data };
  } catch (err) {
    return toActionError(err);
  }
}
