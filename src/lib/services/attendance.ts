import { prisma } from "@/lib/db";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { recordAudit } from "@/lib/services/audit";
import { fromPaise, toPaise } from "@/lib/money";
import { monthRange, startOfDay, toDateParam, toMonthParam } from "@/lib/dates";
import { addDaysInZone, zonedParts } from "@/lib/timezone";
import { formatDate } from "@/lib/format";
import type { SessionUser } from "@/lib/auth/session";
import type { AttendanceMarkData } from "@/lib/validation/schemas";

/**
 * Daily attendance. The manager marks each employee Present, Absent, Half day,
 * Holiday or Leave. Pay rules (the owner's):
 *  - one day's pay is the monthly salary ÷ the number of days in that month;
 *  - Absent is cut, a Half day cuts half a day;
 *  - one Holiday per week (Monday–Sunday), on any day the employee picks, is free;
 *  - Leave is cut unless the owner marks it paid.
 * Holiday and Leave may be added ahead of time. A day nobody marked is shown as
 * "not marked" and is not cut.
 */

/** How far back the manager may mark or change; older days are the owner's. */
export const MANAGER_BACKDATE_DAYS = 6;
/** How far ahead a Holiday or Leave may be added. */
export const PLAN_AHEAD_DAYS = 60;

export type AttendanceDayRow = {
  employeeId: string;
  name: string;
  designation: string | null;
  attendanceId: string | null;
  status: AttendanceStatus | null;
  leavePaid: boolean | null;
  markedByName: string | null;
  /** Another day this week already marked Holiday ("2026-09-29"), if any. */
  holidayOn: string | null;
};

export type AttendanceRecordDTO = {
  id: string;
  /** "2026-09-29" */
  date: string;
  status: AttendanceStatus;
  leavePaid: boolean | null;
  markedByName: string;
};

export type AttendanceSummary = {
  employeeId: string;
  name: string;
  designation: string | null;
  monthlySalary: string | null;
  /** Days of the month that count so far (after joining, up to today). */
  days: number;
  /** Days in the calendar month: one day's pay is salary ÷ this. */
  daysInMonth: number;
  present: number;
  halfDay: number;
  holiday: number;
  leavePaid: number;
  leaveUnpaid: number;
  /** Leave the owner has not decided on yet; cut until they do. */
  leavePending: number;
  absent: number;
  notMarked: number;
  /** Days of pay cut (half days count 0.5). */
  cutDays: number;
  perDay: string | null;
  deduction: string;
};

function assertCanMark(actor: SessionUser) {
  if (!can(actor.role, "attendance.mark")) throw new AppError("You cannot mark attendance.", "FORBIDDEN");
}

function assertOwner(actor: SessionUser) {
  if (!can(actor.role, "employee.manage")) throw new AppError("Only the owner can decide whether a leave is paid.", "FORBIDDEN");
}

/** Monday of the week this day falls in (the salon's zone). */
export function weekStart(day: Date): Date {
  const p = zonedParts(day);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  return addDaysInZone(day, -((dow + 6) % 7));
}

/** Holiday and Leave can be planned ahead; the rest only for today or earlier. */
export const PLANNABLE: ReadonlySet<AttendanceStatus> = new Set(["HOLIDAY", "LEAVE"]);

/** Checks the day can be marked with this status by this person. Returns the day's midnight. */
function checkDay(date: Date, status: AttendanceStatus, actor: SessionUser, now: Date): Date {
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (day > today) {
    if (!PLANNABLE.has(status)) throw new AppError("Only Holiday or Leave can be added for a future day.");
    if (day > addDaysInZone(today, PLAN_AHEAD_DAYS)) throw new AppError(`Holiday or Leave can be added up to ${PLAN_AHEAD_DAYS} days ahead.`);
  }
  if (!can(actor.role, "employee.manage") && day < addDaysInZone(today, -MANAGER_BACKDATE_DAYS)) {
    throw new AppError(`You can mark only the last ${MANAGER_BACKDATE_DAYS + 1} days. Ask the owner to change older days.`, "FORBIDDEN");
  }
  return day;
}

function joinedBy(day: Date) {
  return { OR: [{ joinedAt: null }, { joinedAt: { lt: addDaysInZone(day, 1) } }] };
}

/* ---------- Queries ---------- */

/** Everyone working on this day, with what is marked for them. */
export async function getDayAttendance(date: Date, actor: SessionUser): Promise<AttendanceDayRow[]> {
  assertCanMark(actor);
  const day = startOfDay(date);
  const ws = weekStart(day);
  const [employees, records, holidays] = await Promise.all([
    prisma.employee.findMany({ where: { isActive: true, ...joinedBy(day) }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }),
    prisma.attendance.findMany({ where: { date: day }, include: { markedBy: { select: { name: true } } } }),
    prisma.attendance.findMany({ where: { status: "HOLIDAY", date: { gte: ws, lt: addDaysInZone(ws, 7) }, NOT: { date: day } }, select: { employeeId: true, date: true } }),
  ]);
  const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
  const holidayBy = new Map(holidays.map((h) => [h.employeeId, toDateParam(h.date)]));
  return employees.map((e) => {
    const r = byEmployee.get(e.id);
    return {
      employeeId: e.id,
      name: e.name,
      designation: e.designation,
      attendanceId: r?.id ?? null,
      status: r?.status ?? null,
      leavePaid: r?.leavePaid ?? null,
      markedByName: r?.markedBy.name ?? null,
      holidayOn: holidayBy.get(e.id) ?? null,
    };
  });
}

type EmployeeForSummary = { id: string; name: string; designation: string | null; monthlySalary: { toString(): string } | null; joinedAt: Date | null; leftAt: Date | null };
type RecordForSummary = { employeeId: string; date: Date; status: AttendanceStatus; leavePaid: boolean | null };

/** The span of the month that counts for this person: after joining, before leaving, not in the future. */
function countedSpan(e: EmployeeForSummary, month: string, now: Date): { from: Date; to: Date; days: number } {
  const range = monthRange(month);
  let from = range.from;
  let to = startOfDay(range.to);
  const today = startOfDay(now);
  if (to > today) to = today;
  if (e.joinedAt && startOfDay(e.joinedAt) > from) from = startOfDay(e.joinedAt);
  if (e.leftAt && startOfDay(e.leftAt) < to) to = startOfDay(e.leftAt);
  let days = 0;
  for (let d = from; d <= to; d = addDaysInZone(d, 1)) days++;
  return { from, to, days };
}

/** 28–31: the last day of the month. */
export function daysInMonth(month: string): number {
  return zonedParts(monthRange(month).to).day;
}

function summarise(e: EmployeeForSummary, records: RecordForSummary[], month: string, now: Date): AttendanceSummary {
  const s = { present: 0, halfDay: 0, holiday: 0, leavePaid: 0, leaveUnpaid: 0, leavePending: 0, absent: 0 };
  for (const r of records) {
    if (r.status === "PRESENT") s.present++;
    else if (r.status === "HALF_DAY") s.halfDay++;
    else if (r.status === "HOLIDAY") s.holiday++;
    else if (r.status === "ABSENT") s.absent++;
    else if (r.leavePaid === true) s.leavePaid++;
    else if (r.leavePaid === false) s.leaveUnpaid++;
    else s.leavePending++;
  }
  // Holiday/Leave planned later in the month count towards the cut, not towards "marked so far".
  const span = countedSpan(e, month, now);
  const markedSoFar = records.filter((r) => r.date >= span.from && r.date <= span.to).length;
  const monthDays = daysInMonth(month);
  // In half days, so a half day stays exact.
  const cutHalves = 2 * (s.absent + s.leaveUnpaid + s.leavePending) + s.halfDay;
  const salary = e.monthlySalary ? toPaise(e.monthlySalary.toString()) : null;
  const deduction = salary === null ? 0 : Math.min(salary, Math.round((salary * cutHalves) / (2 * monthDays)));
  return {
    employeeId: e.id,
    name: e.name,
    designation: e.designation,
    monthlySalary: salary === null ? null : fromPaise(salary),
    days: span.days,
    daysInMonth: monthDays,
    ...s,
    notMarked: Math.max(0, span.days - markedSoFar),
    cutDays: cutHalves / 2,
    perDay: salary === null ? null : fromPaise(Math.round(salary / monthDays)),
    deduction: fromPaise(deduction),
  };
}

const summaryEmployeeSelect = { id: true, name: true, designation: true, monthlySalary: true, joinedAt: true, leftAt: true } as const;

/** Salaries are owner-only: for anyone else the summary counts the days but carries no money. */
function forViewer<E extends EmployeeForSummary>(e: E, actor: SessionUser): E {
  return can(actor.role, "employee.manage") ? e : { ...e, monthlySalary: null };
}

/** Month totals for everyone working (plus anyone with attendance that month). */
export async function attendanceSummaries(month: string, actor: SessionUser, now = new Date()): Promise<AttendanceSummary[]> {
  assertCanMark(actor);
  const range = monthRange(month);
  const records = await prisma.attendance.findMany({ where: { date: { gte: range.from, lte: range.to } }, select: { employeeId: true, date: true, status: true, leavePaid: true } });
  const withRecords = [...new Set(records.map((r) => r.employeeId))];
  const employees = await prisma.employee.findMany({
    where: { OR: [{ isActive: true, ...joinedBy(range.to) }, { id: { in: withRecords } }] },
    orderBy: { name: "asc" },
    select: summaryEmployeeSelect,
  });
  return employees.map((e) =>
    summarise(
      forViewer(e, actor),
      records.filter((r) => r.employeeId === e.id),
      month,
      now,
    ),
  );
}

/** One employee's month: totals and each marked day (newest first). */
export async function employeeAttendanceMonth(
  employeeId: string,
  month: string,
  actor: SessionUser,
  now = new Date(),
): Promise<{ summary: AttendanceSummary; records: AttendanceRecordDTO[] } | null> {
  assertCanMark(actor);
  const range = monthRange(month);
  const [employee, records] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: summaryEmployeeSelect }),
    prisma.attendance.findMany({ where: { employeeId, date: { gte: range.from, lte: range.to } }, orderBy: { date: "desc" }, include: { markedBy: { select: { name: true } } } }),
  ]);
  if (!employee) return null;
  return {
    summary: summarise(forViewer(employee, actor), records, month, now),
    records: records.map((r) => ({ id: r.id, date: toDateParam(r.date), status: r.status, leavePaid: r.leavePaid, markedByName: r.markedBy.name })),
  };
}

/** Owner: the month's pay cut for one employee (pre-fills the salary payment). */
export async function absenceCutForMonth(employeeId: string, month: string, actor: SessionUser): Promise<{ cutDays: number; deduction: string }> {
  assertOwner(actor);
  const data = await employeeAttendanceMonth(employeeId, month, actor);
  return { cutDays: data?.summary.cutDays ?? 0, deduction: data?.summary.deduction ?? "0.00" };
}

export type StaffPayRow = { employeeId: string; name: string; days: number; cutDays: number; amount: string };
export type StaffPay = { total: string; staff: StaffPayRow[] };

/**
 * Owner's reports: what the staff cost over a period, by the same pay rules. Every day
 * an employee was with the shop counts one day's pay, less that day's cut. Days still
 * to come are left out.
 */
export async function staffPayForRange(range: { from: Date; to: Date }, now = new Date()): Promise<StaffPay> {
  const from = startOfDay(range.from);
  const today = startOfDay(now);
  const to = startOfDay(range.to) > today ? today : startOfDay(range.to);
  if (from > to) return { total: "0.00", staff: [] };
  const [employees, records] = await Promise.all([
    prisma.employee.findMany({
      where: { monthlySalary: { not: null }, AND: [joinedBy(to), { OR: [{ isActive: true }, { leftAt: { gte: from } }] }] },
      orderBy: { name: "asc" },
      select: summaryEmployeeSelect,
    }),
    prisma.attendance.findMany({ where: { date: { gte: from, lte: to } }, select: { employeeId: true, date: true, status: true, leavePaid: true } }),
  ]);
  const marked = new Map(records.map((r) => [`${r.employeeId}|${toDateParam(r.date)}`, r]));
  let total = 0;
  const staff: StaffPayRow[] = [];
  for (const e of employees) {
    const salary = toPaise(e.monthlySalary!.toString());
    const start = e.joinedAt && startOfDay(e.joinedAt) > from ? startOfDay(e.joinedAt) : from;
    const end = e.leftAt && startOfDay(e.leftAt) < to ? startOfDay(e.leftAt) : to;
    // Paid half days per month, so each month is divided by its own length.
    const paidHalves = new Map<string, number>();
    let days = 0;
    let cutHalves = 0;
    for (let d = start; d <= end; d = addDaysInZone(d, 1)) {
      const r = marked.get(`${e.id}|${toDateParam(d)}`);
      const cut = !r ? 0 : r.status === "ABSENT" || (r.status === "LEAVE" && r.leavePaid !== true) ? 2 : r.status === "HALF_DAY" ? 1 : 0;
      const month = toMonthParam(d);
      paidHalves.set(month, (paidHalves.get(month) ?? 0) + 2 - cut);
      days++;
      cutHalves += cut;
    }
    if (days === 0) continue;
    let paise = 0;
    for (const [month, halves] of paidHalves) paise += Math.round((salary * halves) / (2 * daysInMonth(month)));
    total += paise;
    staff.push({ employeeId: e.id, name: e.name, days, cutDays: cutHalves / 2, amount: fromPaise(paise) });
  }
  return { total: fromPaise(total), staff };
}

export type PendingLeaveDTO ={ id: string; employeeId: string; name: string; date: string; markedByName: string };

/** Owner: leaves nobody has decided on yet, oldest first. */
export async function pendingLeaves(actor: SessionUser): Promise<PendingLeaveDTO[]> {
  assertOwner(actor);
  const rows = await prisma.attendance.findMany({
    where: { status: "LEAVE", leavePaid: null },
    orderBy: { date: "asc" },
    include: { employee: { select: { name: true } }, markedBy: { select: { name: true } } },
    take: 100,
  });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, name: r.employee.name, date: toDateParam(r.date), markedByName: r.markedBy.name }));
}

/* ---------- Mutations ---------- */

const STATUS_TEXT: Record<AttendanceStatus, string> = { PRESENT: "present", HALF_DAY: "half day", HOLIDAY: "holiday", LEAVE: "leave", ABSENT: "absent" };

export async function markAttendance(input: AttendanceMarkData, actor: SessionUser, now = new Date()): Promise<void> {
  assertCanMark(actor);
  const day = checkDay(input.date, input.status, actor, now);
  await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { name: true, isActive: true, joinedAt: true } });
    if (!employee || !employee.isActive) throw new AppError("Employee not found.", "NOT_FOUND");
    if (employee.joinedAt && startOfDay(employee.joinedAt) > day) throw new AppError(`${employee.name} had not joined yet on ${formatDate(day)}.`);

    if (input.status === "HOLIDAY") {
      const ws = weekStart(day);
      const other = await tx.attendance.findFirst({
        where: { employeeId: input.employeeId, status: "HOLIDAY", date: { gte: ws, lt: addDaysInZone(ws, 7) }, NOT: { date: day } },
      });
      if (other) throw new AppError(`${employee.name} already has a holiday this week (${formatDate(other.date)}). Mark Leave or Absent instead.`);
    }

    const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: input.employeeId, date: day } } });
    // Changing to or from Leave resets the owner's paid/unpaid decision.
    const leavePaid = input.status === "LEAVE" && existing?.status === "LEAVE" ? existing.leavePaid : null;
    await tx.attendance.upsert({
      where: { employeeId_date: { employeeId: input.employeeId, date: day } },
      create: { employeeId: input.employeeId, date: day, status: input.status, leavePaid, markedById: actor.id },
      update: { status: input.status, leavePaid, markedById: actor.id },
    });
    await recordAudit(tx, {
      action: "ATTENDANCE_MARKED",
      entityType: "Employee",
      entityId: input.employeeId,
      summary: `${employee.name}: ${STATUS_TEXT[input.status]} on ${formatDate(day)}${existing && existing.status !== input.status ? ` (was ${STATUS_TEXT[existing.status]})` : ""}`,
      actorId: actor.id,
    });
  });
}

/** "All present": everyone not yet marked on this day becomes Present. Returns how many were marked. */
export async function markAllPresent(date: Date, actor: SessionUser, now = new Date()): Promise<number> {
  assertCanMark(actor);
  const day = checkDay(date, "PRESENT", actor, now);
  return prisma.$transaction(async (tx) => {
    const employees = await tx.employee.findMany({ where: { isActive: true, ...joinedBy(day), attendance: { none: { date: day } } }, select: { id: true } });
    if (!employees.length) return 0;
    const { count } = await tx.attendance.createMany({
      data: employees.map((e) => ({ employeeId: e.id, date: day, status: "PRESENT" as const, markedById: actor.id })),
      skipDuplicates: true,
    });
    await recordAudit(tx, {
      action: "ATTENDANCE_MARKED",
      entityType: "Employee",
      summary: `Marked ${count} employee${count === 1 ? "" : "s"} present on ${formatDate(day)}`,
      actorId: actor.id,
    });
    return count;
  });
}

export async function decideLeave(attendanceId: string, paid: boolean, actor: SessionUser): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.findUnique({ where: { id: attendanceId }, include: { employee: { select: { name: true } } } });
    if (!record || record.status !== "LEAVE") throw new AppError("That day is not marked as leave.", "NOT_FOUND");
    await tx.attendance.update({ where: { id: attendanceId }, data: { leavePaid: paid } });
    await recordAudit(tx, {
      action: "LEAVE_DECIDED",
      entityType: "Employee",
      entityId: record.employeeId,
      summary: `${record.employee.name}: leave on ${formatDate(record.date)} is ${paid ? "paid" : "unpaid"}`,
      actorId: actor.id,
    });
  });
}

