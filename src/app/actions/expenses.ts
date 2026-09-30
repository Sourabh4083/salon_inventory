"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { expenseSchema, fieldErrors, type ExpenseInput } from "@/lib/validation/schemas";
import { createExpense, deleteExpense, updateExpense, type ExpenseDTO } from "@/lib/services/expenses";

const INVALID = "Please fix the highlighted fields.";

function revalidateExpenses() {
  revalidatePath("/expenses");
  revalidatePath("/reports");
}

export async function createExpenseAction(input: ExpenseInput): Promise<ActionResult<ExpenseDTO>> {
  try {
    const user = await requirePermission("expense.record");
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const expense = await createExpense(parsed.data, user);
    revalidateExpenses();
    return { ok: true, data: expense };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateExpenseAction(id: string, input: ExpenseInput): Promise<ActionResult<ExpenseDTO>> {
  try {
    const user = await requirePermission("expense.manage");
    const parsed = expenseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const expense = await updateExpense(id, parsed.data, user);
    revalidateExpenses();
    return { ok: true, data: expense };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("expense.record");
    await deleteExpense(id, user);
    revalidateExpenses();
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
