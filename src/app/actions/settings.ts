"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import {
  balancesSchema,
  cashDepositSchema,
  fieldErrors,
  ownerNamesSchema,
  ownerWithdrawalSchema,
  settingsSchema,
  type BalancesInput,
  type CashDepositInput,
  type OwnerNamesInput,
  type OwnerWithdrawalInput,
} from "@/lib/validation/schemas";
import { setOwnerNames, updateSettings, type BusinessSettingsData } from "@/lib/services/settings";
import { addOwnerWithdrawal, deleteCashDeposit, deleteOwnerWithdrawal, moveCashToBank, setBalances } from "@/lib/services/cashbook";

/** Owner: types what is in the drawer and the bank now; the running balances restart from there. */
export async function setBalancesAction(input: BalancesInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("report.view");
    const parsed = balancesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    await setBalances(parsed.data, user);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner: cash carried from the drawer to the bank. */
export async function moveCashToBankAction(input: CashDepositInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("report.view");
    const parsed = cashDepositSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    await moveCashToBank(parsed.data, user);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteCashDepositAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("report.view");
    await deleteCashDeposit(id, user);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

/** Owner: money one of the owners took from the shop for themselves. */
export async function addOwnerWithdrawalAction(input: OwnerWithdrawalInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("report.view");
    const parsed = ownerWithdrawalSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    await addOwnerWithdrawal(parsed.data, user);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteOwnerWithdrawalAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("report.view");
    await deleteOwnerWithdrawal(id, user);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setOwnerNamesAction(input: OwnerNamesInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings.manage");
    const parsed = ownerNamesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the names." };
    await setOwnerNames(parsed.data.names, user.id);
    revalidatePath("/settings");
    revalidatePath("/reports");
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

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
