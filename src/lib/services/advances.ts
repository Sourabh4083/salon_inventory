import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { recordAudit } from "@/lib/services/audit";
import { fromPaise, toPaise } from "@/lib/money";
import { endOfDay, monthRange, startOfDay, toMonthParam } from "@/lib/dates";
import type { SessionUser } from "@/lib/auth/session";
import type { AdvanceData } from "@/lib/validation/schemas";

/**
 * Cash an employee takes from the shop during the month. The manager notes it on the
 * day it happens; both manager and owner can browse a month's entries and total, and
 * at month end the owner deducts it from the salary.
 */

export type AdvanceDTO = {
  id: string;
  employeeId: string;
  amount: string;
  takenOn: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
  /** Whether the viewer may remove this entry. */
  canDelete: boolean;
};

export type AdvanceList = { items: AdvanceDTO[]; total: string };

const advanceInclude = { createdBy: { select: { name: true } } } satisfies Prisma.EmployeeAdvanceInclude;
type AdvanceRow = Prisma.EmployeeAdvanceGetPayload<{ include: typeof advanceInclude }>;

function isToday(d: Date, now = new Date()) {
  return d >= startOfDay(now) && d <= endOfDay(now);
}

/** Owner: anything. Manager: only what they entered themselves today. */
function mayDelete(a: { createdById: string; createdAt: Date }, actor: SessionUser) {
  if (actor.role === "OWNER") return true;
  return a.createdById === actor.id && isToday(a.createdAt);
}

function toAdvanceDTO(a: AdvanceRow, actor: SessionUser): AdvanceDTO {
  return {
    id: a.id,
    employeeId: a.employeeId,
    amount: a.amount.toString(),
    takenOn: a.takenOn.toISOString(),
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    createdByName: a.createdBy.name,
    canDelete: mayDelete(a, actor),
  };
}

function assertCanRecord(actor: SessionUser) {
  if (!can(actor.role, "advance.record")) throw new AppError("You cannot record advances.", "FORBIDDEN");
}

function assertOwner(actor: SessionUser) {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can see advance totals.", "FORBIDDEN");
}

function sum(rows: { amount: Prisma.Decimal }[]) {
  return fromPaise(rows.reduce((n, r) => n + toPaise(r.amount.toString()), 0));
}

/* ---------- Queries ---------- */

/** The given month's entries for this employee (default: this month) and their total. */
export async function listAdvances(employeeId: string, actor: SessionUser, month?: string): Promise<AdvanceList> {
  assertCanRecord(actor);
  const range = monthRange(month ?? toMonthParam());
  const rows = await prisma.employeeAdvance.findMany({
    where: { employeeId, takenOn: { gte: range.from, lte: range.to } },
    orderBy: [{ takenOn: "desc" }, { createdAt: "desc" }],
    include: advanceInclude,
  });
  return { items: rows.map((r) => toAdvanceDTO(r, actor)), total: sum(rows) };
}

/** Owner: total advances per employee for a "YYYY-MM" month. Employees with none are left out. */
export async function advanceTotalsForMonth(employeeIds: string[], month: string, actor: SessionUser): Promise<Map<string, string>> {
  assertOwner(actor);
  if (employeeIds.length === 0) return new Map();
  const range = monthRange(month);
  const groups = await prisma.employeeAdvance.groupBy({
    by: ["employeeId"],
    where: { employeeId: { in: employeeIds }, takenOn: { gte: range.from, lte: range.to } },
    _sum: { amount: true },
  });
  return new Map(groups.map((g) => [g.employeeId, fromPaise(toPaise(g._sum.amount?.toString() ?? "0"))]));
}

/** Owner: one employee's advance total for a month (used to pre-fill the salary payment). */
export async function advanceTotalForMonth(employeeId: string, month: string, actor: SessionUser): Promise<string> {
  return (await advanceTotalsForMonth([employeeId], month, actor)).get(employeeId) ?? "0.00";
}

/* ---------- Mutations ---------- */

export async function recordAdvance(input: AdvanceData, actor: SessionUser): Promise<AdvanceDTO> {
  assertCanRecord(actor);
  const now = new Date();
  let takenOn = now;
  if (input.takenOn && actor.role === "OWNER") {
    if (input.takenOn > endOfDay(now)) throw new AppError("The date cannot be in the future.");
    // A back-dated entry is filed on that day; today's keeps the real time.
    if (!isToday(input.takenOn, now)) takenOn = input.takenOn;
  }
  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { name: true, isActive: true } });
    if (!employee) throw new AppError("Employee not found.", "NOT_FOUND");
    if (!employee.isActive && actor.role !== "OWNER") throw new AppError("This employee has left the shop.");
    const advance = await tx.employeeAdvance.create({
      data: { employeeId: input.employeeId, amount: input.amount, takenOn, note: input.note, createdById: actor.id },
      include: advanceInclude,
    });
    await recordAudit(tx, {
      action: "ADVANCE_RECORDED",
      entityType: "Employee",
      entityId: input.employeeId,
      summary: `Advance ${input.amount} given to "${employee.name}"${input.note ? ` (${input.note})` : ""}`,
      metadata: { advanceId: advance.id, amount: input.amount, takenOn: takenOn.toISOString() },
      actorId: actor.id,
    });
    return advance;
  });
  return toAdvanceDTO(created, actor);
}

export async function deleteAdvance(advanceId: string, actor: SessionUser): Promise<{ employeeId: string }> {
  assertCanRecord(actor);
  return prisma.$transaction(async (tx) => {
    const advance = await tx.employeeAdvance.findUnique({ where: { id: advanceId }, include: { employee: { select: { name: true } } } });
    if (!advance) throw new AppError("Entry not found.", "NOT_FOUND");
    if (!mayDelete(advance, actor)) throw new AppError("Only entries you made today can be removed. Ask the owner to fix older ones.", "FORBIDDEN");
    await tx.employeeAdvance.delete({ where: { id: advanceId } });
    await recordAudit(tx, {
      action: "ADVANCE_DELETED",
      entityType: "Employee",
      entityId: advance.employeeId,
      summary: `Removed advance ${advance.amount.toString()} of "${advance.employee.name}"`,
      metadata: { advanceId, amount: advance.amount.toString(), takenOn: advance.takenOn.toISOString() },
      actorId: actor.id,
    });
    return { employeeId: advance.employeeId };
  });
}
