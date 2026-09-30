import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { recordAudit } from "@/lib/services/audit";
import { fromPaise, toPaise } from "@/lib/money";
import { endOfDay, startOfDay } from "@/lib/dates";
import { PAGE_SIZE } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";
import type { ExpenseData } from "@/lib/validation/schemas";

/**
 * The shop's day-to-day spending (tea, cleaning, electricity, ...). Owner and manager
 * both add entries; the manager only ever sees today's, the owner sees any period.
 */

export type ExpenseDTO = {
  id: string;
  spentOn: string;
  amount: string;
  description: string;
  paymentMethod: PaymentMethod;
  createdAt: string;
  createdByName: string;
  canEdit: boolean;
  canDelete: boolean;
};

const expenseInclude = { createdBy: { select: { name: true } } } satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function isToday(d: Date, now = new Date()) {
  return d >= startOfDay(now) && d <= endOfDay(now);
}

function mayDelete(e: { createdById: string; createdAt: Date }, actor: SessionUser) {
  if (can(actor.role, "expense.manage")) return true;
  return e.createdById === actor.id && isToday(e.createdAt);
}

function toExpenseDTO(e: ExpenseRow, actor: SessionUser): ExpenseDTO {
  return {
    id: e.id,
    spentOn: e.spentOn.toISOString(),
    amount: e.amount.toString(),
    description: e.description,
    paymentMethod: e.paymentMethod,
    createdAt: e.createdAt.toISOString(),
    createdByName: e.createdBy.name,
    canEdit: can(actor.role, "expense.manage"),
    canDelete: mayDelete(e, actor),
  };
}

function assertCanRecord(actor: SessionUser) {
  if (!can(actor.role, "expense.record")) throw new AppError("You cannot record expenses.", "FORBIDDEN");
}

function assertCanManage(actor: SessionUser) {
  if (!can(actor.role, "expense.manage")) throw new AppError("Only the owner can change expenses.", "FORBIDDEN");
}

/** Owner may pick any past day; everyone else's entries are dated now. */
function resolveSpentOn(input: Date | null, actor: SessionUser, now = new Date()): Date {
  if (!input || !can(actor.role, "expense.manage")) return now;
  if (input > endOfDay(now)) throw new AppError("The date cannot be in the future.");
  return isToday(input, now) ? now : input;
}

/* ---------- Queries ---------- */

export type ExpensePage = { items: ExpenseDTO[]; total: number; amount: string; page: number; pageSize: number; pageCount: number };

/** The manager's range is always forced to today. */
export async function listExpenses(params: { from?: Date; to?: Date; page?: number; pageSize?: number }, actor: SessionUser): Promise<ExpensePage> {
  assertCanRecord(actor);
  const now = new Date();
  const owner = can(actor.role, "expense.manage");
  const from = owner ? (params.from ?? startOfDay(now)) : startOfDay(now);
  const to = owner ? (params.to ?? endOfDay(now)) : endOfDay(now);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const where: Prisma.ExpenseWhereInput = { spentOn: { gte: from, lte: to } };
  const [rows, total, agg] = await Promise.all([
    prisma.expense.findMany({ where, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], include: expenseInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);
  return {
    items: rows.map((r) => toExpenseDTO(r, actor)),
    total,
    amount: fromPaise(toPaise(agg._sum.amount?.toString() ?? "0")),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Sum of expenses in a period (for the owner's reports). */
export async function expenseTotal(range: { from: Date; to: Date }): Promise<string> {
  const agg = await prisma.expense.aggregate({ where: { spentOn: { gte: range.from, lte: range.to } }, _sum: { amount: true } });
  return fromPaise(toPaise(agg._sum.amount?.toString() ?? "0"));
}

/* ---------- Mutations ---------- */

export async function createExpense(input: ExpenseData, actor: SessionUser): Promise<ExpenseDTO> {
  assertCanRecord(actor);
  const spentOn = resolveSpentOn(input.spentOn, actor);
  const created = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: { spentOn, amount: input.amount, description: input.description, paymentMethod: input.paymentMethod, createdById: actor.id },
      include: expenseInclude,
    });
    await recordAudit(tx, {
      action: "EXPENSE_CREATED",
      entityType: "Expense",
      entityId: expense.id,
      summary: `Expense ${input.amount} for "${input.description}" (${input.paymentMethod})`,
      actorId: actor.id,
    });
    return expense;
  });
  return toExpenseDTO(created, actor);
}

export async function updateExpense(id: string, input: ExpenseData, actor: SessionUser): Promise<ExpenseDTO> {
  assertCanManage(actor);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError("Expense not found.", "NOT_FOUND");
    // Keep the original time when the day did not change.
    const spentOn = input.spentOn && !isToday(input.spentOn, existing.spentOn) ? resolveSpentOn(input.spentOn, actor) : existing.spentOn;
    const expense = await tx.expense.update({
      where: { id },
      data: { spentOn, amount: input.amount, description: input.description, paymentMethod: input.paymentMethod },
      include: expenseInclude,
    });
    await recordAudit(tx, {
      action: "EXPENSE_UPDATED",
      entityType: "Expense",
      entityId: id,
      summary: `Edited expense "${expense.description}" (${existing.amount.toString()} → ${expense.amount.toString()})`,
      metadata: {
        before: { amount: existing.amount.toString(), description: existing.description, spentOn: existing.spentOn.toISOString(), paymentMethod: existing.paymentMethod },
      },
      actorId: actor.id,
    });
    return expense;
  });
  return toExpenseDTO(updated, actor);
}

export async function deleteExpense(id: string, actor: SessionUser): Promise<void> {
  assertCanRecord(actor);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.expense.findUnique({ where: { id } });
    if (!existing) throw new AppError("Expense not found.", "NOT_FOUND");
    if (!mayDelete(existing, actor)) throw new AppError("Only entries you made today can be removed. Ask the owner to fix older ones.", "FORBIDDEN");
    await tx.expense.delete({ where: { id } });
    await recordAudit(tx, {
      action: "EXPENSE_DELETED",
      entityType: "Expense",
      entityId: id,
      summary: `Removed expense ${existing.amount.toString()} for "${existing.description}"`,
      metadata: { amount: existing.amount.toString(), description: existing.description, spentOn: existing.spentOn.toISOString() },
      actorId: actor.id,
    });
  });
}
