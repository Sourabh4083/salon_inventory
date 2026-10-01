import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addSalaryPayment, createEmployee, setEmployeeActive } from "@/lib/services/employees";
import {
  absenceCutForMonth,
  attendanceSummaries,
  daysInMonth,
  decideLeave,
  employeeAttendanceMonth,
  getDayAttendance,
  markAllPresent,
  markAttendance,
  pendingLeaves,
  weekStart,
} from "@/lib/services/attendance";
import { attendanceMarkSchema, employeeSchema, salaryPaymentSchema } from "@/lib/validation/schemas";
import { startOfDay, toDateParam, toMonthParam } from "@/lib/dates";
import { addDaysInZone, zonedDate } from "@/lib/timezone";
import { can } from "@/lib/permissions";
import { seedBasics } from "./helpers";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let sunita = "";

const today = () => startOfDay(new Date());
const day = (offset: number) => toDateParam(addDaysInZone(today(), offset));

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  sunita = (await createEmployee(employeeSchema.parse({ name: "Sunita", monthlySalary: "15500", joinedAt: "2025-01-01" }), owner)).id;
});

function mark(employeeId: string, date: string, status: AttendanceStatus, actor = manager) {
  return markAttendance(attendanceMarkSchema.parse({ employeeId, date, status }), actor);
}

/** Fills a past month directly: statuses in order from the 1st. */
async function fillMonth(employeeId: string, year: number, month: number, statuses: [AttendanceStatus, boolean | null][]) {
  await prisma.attendance.createMany({
    data: statuses.map(([status, leavePaid], i) => ({ employeeId, date: zonedDate(year, month, i + 1), status, leavePaid, markedById: owner.id })),
  });
}

const repeat = (n: number, status: AttendanceStatus, leavePaid: boolean | null = null) => Array.from({ length: n }, () => [status, leavePaid] as [AttendanceStatus, boolean | null]);

describe("permissions", () => {
  it("manager and owner mark attendance; only the owner decides paid leave", async () => {
    expect(can("MANAGER", "attendance.mark")).toBe(true);
    expect(can("OWNER", "attendance.mark")).toBe(true);
    await mark(sunita, day(0), "LEAVE");
    const record = await prisma.attendance.findFirstOrThrow();
    await expect(decideLeave(record.id, true, manager)).rejects.toThrow(/owner/i);
    await expect(pendingLeaves(manager)).rejects.toThrow(/owner/i);
  });
});

describe("marking", () => {
  it("saves one status per day and changes it on a second tap", async () => {
    await mark(sunita, day(0), "ABSENT");
    await mark(sunita, day(0), "PRESENT");
    const rows = await prisma.attendance.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PRESENT");
    expect(await prisma.auditLog.count({ where: { action: "ATTENDANCE_MARKED", entityId: sunita } })).toBe(2);
  });

  it("only Holiday or Leave can be added ahead, up to 60 days", async () => {
    await expect(mark(sunita, day(1), "PRESENT")).rejects.toThrow(/only holiday or leave/i);
    await expect(mark(sunita, day(1), "ABSENT")).rejects.toThrow(/only holiday or leave/i);
    await expect(mark(sunita, day(1), "HALF_DAY")).rejects.toThrow(/only holiday or leave/i);
    await mark(sunita, day(3), "LEAVE");
    await mark(sunita, day(14), "HOLIDAY");
    await expect(mark(sunita, day(61), "LEAVE")).rejects.toThrow(/60 days/i);
  });

  it("the manager fixes only the last 7 days; the owner any day", async () => {
    await mark(sunita, day(-6), "PRESENT");
    await expect(mark(sunita, day(-7), "PRESENT")).rejects.toThrow(/owner/i);
    await mark(sunita, day(-40), "ABSENT", owner);
  });

  it("refuses days before joining and people who left", async () => {
    const newJoiner = await createEmployee(employeeSchema.parse({ name: "New", joinedAt: day(0) }), owner);
    await expect(mark(newJoiner.id, day(-1), "PRESENT")).rejects.toThrow(/not joined/i);
    await mark(newJoiner.id, day(0), "PRESENT");
    await setEmployeeActive(newJoiner.id, false, owner);
    await expect(mark(newJoiner.id, day(0), "ABSENT")).rejects.toThrow(/not found/i);
  });

  it("allows one holiday per Monday–Sunday week, on any day", async () => {
    const monday = addDaysInZone(weekStart(today()), -14);
    const d = (n: number) => toDateParam(addDaysInZone(monday, n));
    await mark(sunita, d(3), "HOLIDAY", owner); // Thursday
    await mark(sunita, d(3), "HOLIDAY", owner); // same day again is fine
    await expect(mark(sunita, d(6), "HOLIDAY", owner)).rejects.toThrow(/already has a holiday/i); // Sunday, same week
    await mark(sunita, d(6), "LEAVE", owner);
    await mark(sunita, d(7), "HOLIDAY", owner); // next Monday: new week
  });

  it("All present marks only people not yet marked", async () => {
    const asha = (await createEmployee(employeeSchema.parse({ name: "Asha" }), owner)).id;
    const left = (await createEmployee(employeeSchema.parse({ name: "Left" }), owner)).id;
    await setEmployeeActive(left, false, owner);
    await mark(sunita, day(0), "ABSENT");
    expect(await markAllPresent(today(), manager)).toBe(1);
    const rows = await getDayAttendance(today(), manager);
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ["Asha", "PRESENT"],
      ["Sunita", "ABSENT"],
    ]);
    expect(rows.find((r) => r.employeeId === asha)?.markedByName).toBe("Test Manager");
    await expect(markAllPresent(addDaysInZone(today(), 1), manager)).rejects.toThrow(/future/i);
  });

  it("the day sheet shows a holiday already taken this week", async () => {
    const monday = addDaysInZone(weekStart(today()), -7);
    await mark(sunita, toDateParam(addDaysInZone(monday, 2)), "HOLIDAY", owner);
    const rows = await getDayAttendance(addDaysInZone(monday, 4), owner);
    expect(rows[0].holidayOn).toBe(toDateParam(addDaysInZone(monday, 2)));
  });
});

describe("pay cut: salary ÷ days in the month", () => {
  it("knows each month's length", () => {
    expect(daysInMonth("2026-10")).toBe(31);
    expect(daysInMonth("2026-11")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
  });

  it("October: absent, unpaid or undecided leave cut a day, half day cuts half, holiday and paid leave nothing", async () => {
    // 31 days: 20 present, 2 absent, 2 half days, 4 holidays, 1 paid + 1 unpaid + 1 undecided leave.
    await fillMonth(sunita, 2025, 10, [
      ...repeat(20, "PRESENT"),
      ...repeat(2, "ABSENT"),
      ...repeat(2, "HALF_DAY"),
      ...repeat(4, "HOLIDAY"),
      ["LEAVE", true],
      ["LEAVE", false],
      ["LEAVE", null],
    ]);
    const [s] = await attendanceSummaries("2025-10", owner);
    expect(s).toMatchObject({
      days: 31,
      daysInMonth: 31,
      present: 20,
      absent: 2,
      halfDay: 2,
      holiday: 4,
      leavePaid: 1,
      leaveUnpaid: 1,
      leavePending: 1,
      notMarked: 0,
      cutDays: 5, // 2 absent + 1 unpaid + 1 undecided + 2 × ½
      perDay: "500.00", // 15,500 ÷ 31
      deduction: "2500.00",
    });
    expect(await absenceCutForMonth(sunita, "2025-10", owner)).toEqual({ cutDays: 5, deduction: "2500.00" });
  });

  it("February (28 days): one absent day on 14,000 is 500", async () => {
    const e = (await createEmployee(employeeSchema.parse({ name: "Feb", monthlySalary: "14000", joinedAt: "2025-01-01" }), owner)).id;
    await fillMonth(e, 2026, 2, [["ABSENT", null]]);
    expect(await absenceCutForMonth(e, "2026-02", owner)).toEqual({ cutDays: 1, deduction: "500.00" });
  });

  it("deciding a pending leave as paid removes its cut; the pending list empties; changing the day resets the decision", async () => {
    await fillMonth(sunita, 2025, 10, [["LEAVE", null]]);
    const leave = await prisma.attendance.findFirstOrThrow();
    expect((await pendingLeaves(owner)).map((l) => l.id)).toEqual([leave.id]);
    expect((await absenceCutForMonth(sunita, "2025-10", owner)).deduction).toBe("500.00");

    await decideLeave(leave.id, true, owner);
    expect((await absenceCutForMonth(sunita, "2025-10", owner)).deduction).toBe("0.00");
    expect(await pendingLeaves(owner)).toEqual([]);

    await mark(sunita, "2025-10-01", "ABSENT", owner);
    await mark(sunita, "2025-10-01", "LEAVE", owner);
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: leave.id } })).leavePaid).toBeNull();
  });

  it("counts unmarked days without cutting them, and only from the joining day", async () => {
    const mid = (await createEmployee(employeeSchema.parse({ name: "Mid", monthlySalary: "9300", joinedAt: "2025-10-21" }), owner)).id;
    await fillMonth(sunita, 2025, 10, [["ABSENT", null]]);
    const summaries = await attendanceSummaries("2025-10", owner);
    expect(summaries.find((s) => s.employeeId === sunita)).toMatchObject({ days: 31, notMarked: 30, absent: 1, deduction: "500.00" });
    expect(summaries.find((s) => s.employeeId === mid)).toMatchObject({ days: 11, notMarked: 11, deduction: "0.00" });
  });

  it("this month: days count up to today, and planned leave later in the month is already cut", async () => {
    const data = await employeeAttendanceMonth(sunita, toMonthParam(), manager);
    expect(data!.summary.days).toBe(Number(toDateParam(new Date()).slice(8)));
    const last = daysInMonth(toMonthParam());
    const todayNum = Number(toDateParam(new Date()).slice(8));
    if (todayNum < last) {
      await mark(sunita, day(1), "LEAVE");
      const after = await employeeAttendanceMonth(sunita, toMonthParam(), manager);
      expect(after!.summary.leavePending).toBe(1);
      expect(after!.summary.notMarked).toBe(todayNum); // the planned day is not "marked so far"
    }
  });

  it("a salary payment keeps the attendance cut it was paid with", async () => {
    const p = await addSalaryPayment(
      salaryPaymentSchema.parse({ employeeId: sunita, amount: "13000", paidOn: "2025-11-01", periodMonth: "2025-10", absenceDeducted: "2500" }),
      owner,
    );
    expect(p.absenceDeducted).toBe("2500");
  });
});
