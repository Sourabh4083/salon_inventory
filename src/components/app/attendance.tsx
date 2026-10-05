"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { decideLeaveAction, markAllPresentAction, markAttendanceAction } from "@/app/actions/attendance";
import type { AttendanceDayRow, AttendanceRecordDTO, AttendanceSummary, PendingLeaveDTO } from "@/lib/services/attendance";
import type { AttendanceStatus } from "@/generated/prisma/enums";
import { formatMonth } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* ---------- Labels ---------- */

export const ATTENDANCE_META: Record<AttendanceStatus, { label: string; active: string; chip: string }> = {
  PRESENT: {
    label: "Present",
    active: "border-emerald-600 bg-emerald-600 text-white",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  ABSENT: {
    label: "Absent",
    active: "border-red-600 bg-red-600 text-white",
    chip: "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300",
  },
  HALF_DAY: {
    label: "Half day",
    active: "border-amber-500 bg-amber-500 text-white",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  },
  HOLIDAY: {
    label: "Holiday",
    active: "border-sky-600 bg-sky-600 text-white",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300",
  },
  LEAVE: {
    label: "Leave",
    active: "border-violet-600 bg-violet-600 text-white",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/10 dark:text-violet-300",
  },
};

const MAIN: AttendanceStatus[] = ["PRESENT", "ABSENT"];
const OTHER: AttendanceStatus[] = ["HALF_DAY", "HOLIDAY", "LEAVE"];
/** Can be added for a future day. */
const PLANNABLE = new Set<AttendanceStatus>(["HOLIDAY", "LEAVE"]);

const weekdayFormatter = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" });

/** "Tue 29 Sep 2026" for a "2026-09-29" day. */
export function dayWithWeekday(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${weekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)))} ${formatDate(day)}`;
}

function StatusChip({ status, leavePaid }: { status: AttendanceStatus; leavePaid: boolean | null }) {
  const leaveText = status === "LEAVE" ? (leavePaid === true ? " · paid" : leavePaid === false ? " · unpaid" : " · owner to decide") : "";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase", ATTENDANCE_META[status].chip)}>
      {ATTENDANCE_META[status].label}
      {leaveText}
    </span>
  );
}

/* ---------- Leave decision (owner) ---------- */

export function LeaveDecision({ attendanceId, leavePaid }: { attendanceId: string; leavePaid: boolean | null }) {
  const [pending, start] = useTransition();
  const decide = (paid: boolean) =>
    start(async () => {
      const res = await decideLeaveAction(attendanceId, paid);
      if (!res.ok) toast.error(res.error);
      else toast.success(paid ? "Paid leave: no pay cut" : "Unpaid leave: one day's pay is cut");
    });
  const btn = (active: boolean) => cn("h-9 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-60", active ? "border-violet-600 bg-violet-600 text-white" : "bg-background hover:bg-muted");
  return (
    <span className="inline-flex items-center gap-1.5">
      {pending ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
      <button type="button" className={btn(leavePaid === true)} disabled={pending} onClick={() => decide(true)} aria-pressed={leavePaid === true}>
        Paid
      </button>
      <button type="button" className={btn(leavePaid === false)} disabled={pending} onClick={() => decide(false)} aria-pressed={leavePaid === false}>
        Unpaid
      </button>
    </span>
  );
}

/** Owner: leaves nobody has decided on yet. */
export function PendingLeaves({ leaves }: { leaves: PendingLeaveDTO[] }) {
  if (!leaves.length) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/10">
      <h2 className="text-sm font-semibold text-violet-900 dark:text-violet-200">
        {leaves.length} leave{leaves.length === 1 ? "" : "s"} waiting for your decision
      </h2>
      <ul className="divide-y divide-violet-200 dark:divide-violet-500/20">
        {leaves.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
            <Link href={`/employees/${l.employeeId}`} className="font-medium hover:underline">
              {l.name}
            </Link>
            <span className="tabular-nums">{dayWithWeekday(l.date)}</span>
            <span className="text-xs text-muted-foreground">added by {l.markedByName}</span>
            <span className="ml-auto">
              <LeaveDecision attendanceId={l.id} leavePaid={null} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Day sheet ---------- */

export function AttendanceDay({
  day,
  today,
  prevDay,
  nextDay,
  maxDay,
  rows,
  canEdit,
  isOwner,
}: {
  day: string;
  today: string;
  prevDay: string;
  nextDay: string | null;
  /** Furthest future day a Holiday or Leave may be added for. */
  maxDay: string;
  rows: AttendanceDayRow[];
  /** False for days too old for the manager to change. */
  canEdit: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [markingAll, startAll] = useTransition();
  const future = day > today;
  const unmarked = rows.filter((r) => !r.status).length;
  const counts = [...MAIN, ...OTHER].map((s) => ({ s, n: rows.filter((r) => r.status === s).length })).filter((c) => c.n > 0);

  const markAll = () =>
    startAll(async () => {
      const res = await markAllPresentAction(day);
      if (!res.ok) toast.error(res.error);
      else toast.success(`${res.data} marked present`);
    });

  const dayHref = (d: string) => (d === today ? "/attendance" : `/attendance?date=${d}`);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-lg" variant="outline" className="size-11" render={<Link href={dayHref(prevDay)} />} aria-label="Previous day">
          <ChevronLeft />
        </Button>
        <Input type="date" className="h-11 w-44" value={day} max={maxDay} onChange={(e) => e.target.value && router.push(dayHref(e.target.value))} aria-label="Day" />
        {nextDay ? (
          <Button size="icon-lg" variant="outline" className="size-11" render={<Link href={dayHref(nextDay)} />} aria-label="Next day">
            <ChevronRight />
          </Button>
        ) : null}
        <h2 className="font-heading text-lg">
          {day === today ? "Today · " : ""}
          {dayWithWeekday(day)}
        </h2>
        {day !== today ? (
          <Link href="/attendance" className="text-sm font-medium text-primary hover:underline">
            Back to today
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {counts.map(({ s, n }) => (
          <span key={s} className={cn("rounded-full px-2.5 py-1 font-medium", ATTENDANCE_META[s].chip)}>
            {ATTENDANCE_META[s].label}: {n}
          </span>
        ))}
        {!future && unmarked ? <span className="rounded-full bg-orange-100 px-2.5 py-1 font-medium text-orange-800 dark:bg-orange-500/10 dark:text-orange-300">Not marked: {unmarked}</span> : null}
        {canEdit && !future && unmarked ? (
          <Button size="lg" className="ml-auto h-11" onClick={markAll} disabled={markingAll}>
            {markingAll ? <LoaderCircle className="animate-spin" /> : <CheckCheck />} All present
          </Button>
        ) : null}
      </div>

      {future ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">This day is ahead. You can add a Holiday or Leave now; mark Present or Absent on the day.</p>
      ) : !canEdit ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">This day is too old to change here. Ask the owner if something is wrong.</p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No working employees on this day.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card shadow-xs">
          {rows.map((r) => (
            <AttendanceRow key={r.employeeId} row={r} day={day} canEdit={canEdit} future={future} isOwner={isOwner} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttendanceRow({ row, day, canEdit, future, isOwner }: { row: AttendanceDayRow; day: string; canEdit: boolean; future: boolean; isOwner: boolean }) {
  // Shows the tapped status at once; falls back to the saved one if saving fails.
  const [status, setStatus] = useOptimistic(row.status);
  const [pending, start] = useTransition();

  const mark = (next: AttendanceStatus) => {
    if (next === status) return;
    start(async () => {
      setStatus(next);
      const res = await markAttendanceAction({ employeeId: row.employeeId, date: day, status: next });
      if (!res.ok) toast.error(res.error);
    });
  };

  const holidayTaken = row.holidayOn !== null && status !== "HOLIDAY";
  const disabled = (s: AttendanceStatus) => !canEdit || (future && !PLANNABLE.has(s)) || (s === "HOLIDAY" && holidayTaken);
  const button = (s: AttendanceStatus, big: boolean) => (
    <button
      key={s}
      type="button"
      role="radio"
      aria-checked={status === s}
      disabled={disabled(s)}
      onClick={() => mark(s)}
      title={s === "HOLIDAY" && holidayTaken ? "Only one holiday per week" : undefined}
      className={cn(
        "rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        big ? "min-h-12 px-3 text-sm sm:text-base" : "min-h-10 px-2 text-xs sm:text-sm",
        status === s ? ATTENDANCE_META[s].active : "bg-background hover:bg-muted",
      )}
    >
      {ATTENDANCE_META[s].label}
    </button>
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={`/employees/${row.employeeId}`} className="font-semibold hover:underline">
            {row.name}
          </Link>
          {pending ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
          {!status && !future ? <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Not marked</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.designation ?? "Staff"}
          {holidayTaken ? ` · holiday this week: ${dayWithWeekday(row.holidayOn!)}` : ""}
        </p>
        {status === "LEAVE" && row.status === "LEAVE" && row.attendanceId ? (
          <div className="mt-1.5">
            {isOwner ? (
              <LeaveDecision attendanceId={row.attendanceId} leavePaid={row.leavePaid} />
            ) : (
              <p className="text-xs text-violet-700 dark:text-violet-300">{row.leavePaid === null ? "The owner will decide if this leave is paid." : row.leavePaid ? "Paid leave" : "Unpaid leave"}</p>
            )}
          </div>
        ) : null}
      </div>
      <div className="space-y-1.5 lg:w-[26rem]" role="radiogroup" aria-label={`Attendance for ${row.name}`}>
        <div className="grid grid-cols-2 gap-1.5">{MAIN.map((s) => button(s, true))}</div>
        <div className="grid grid-cols-3 gap-1.5">{OTHER.map((s) => button(s, false))}</div>
      </div>
    </li>
  );
}

/* ---------- Month ---------- */

export function MonthPicker({ month, max }: { month: string; max: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const setMonth = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("month", value);
    else next.delete("month");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Input type="month" className="h-11 w-44" value={month} max={max} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      {pending ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
    </span>
  );
}

/** "2 absent · 1 half day · 1 unpaid leave" — what was cut. */
function cutBreakdown(s: AttendanceSummary) {
  const parts = [
    s.absent ? `${s.absent} absent` : null,
    s.halfDay ? `${s.halfDay} half day${s.halfDay === 1 ? "" : "s"}` : null,
    s.leaveUnpaid ? `${s.leaveUnpaid} unpaid leave` : null,
    s.leavePending ? `${s.leavePending} leave waiting for owner` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing cut";
}

export function AttendanceMonthTable({ summaries, month, isOwner, currencySymbol }: { summaries: AttendanceSummary[]; month: string; isOwner: boolean; currencySymbol: string }) {
  if (!summaries.length) return <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No employees in {formatMonth(month)}.</p>;
  const head = "px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
  const cell = "px-3 py-2.5 text-right tabular-nums";
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-xs">
      <table className="w-full min-w-[52rem] text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Employee</th>
            <th className={head}>Present</th>
            <th className={head}>Absent</th>
            <th className={head}>Half day</th>
            <th className={head}>Holiday</th>
            <th className={head}>Leave (paid / unpaid)</th>
            <th className={head}>Not marked</th>
            <th className={head}>Days cut</th>
            {isOwner ? <th className={head}>Pay cut</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {summaries.map((s) => (
            <tr key={s.employeeId}>
              <td className="px-3 py-2.5">
                <Link href={`/employees/${s.employeeId}?month=${month}`} className="font-medium hover:underline">
                  {s.name}
                </Link>
                <p className="text-xs text-muted-foreground">{s.designation ?? "Staff"}</p>
              </td>
              <td className={cell}>{s.present}</td>
              <td className={cn(cell, s.absent ? "font-semibold text-destructive" : "")}>{s.absent || "—"}</td>
              <td className={cell}>{s.halfDay || "—"}</td>
              <td className={cell}>{s.holiday || "—"}</td>
              <td className={cell}>
                {s.leavePaid + s.leaveUnpaid + s.leavePending ? (
                  <>
                    {s.leavePaid} / {s.leaveUnpaid}
                    {s.leavePending ? <span className="block text-xs font-medium text-violet-700 dark:text-violet-300">{s.leavePending} to decide</span> : null}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className={cn(cell, s.notMarked ? "font-medium text-orange-700 dark:text-orange-400" : "")}>{s.notMarked || "—"}</td>
              <td className={cell}>{s.cutDays || "—"}</td>
              {isOwner ? <td className={cn(cell, "font-semibold")}>{Number(s.deduction) > 0 ? `− ${formatMoney(s.deduction, currencySymbol)}` : "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- One employee's month (employee page) ---------- */

export function EmployeeAttendance({
  summary,
  records,
  month,
  maxMonth,
  isOwner,
  currencySymbol,
}: {
  summary: AttendanceSummary;
  records: AttendanceRecordDTO[];
  month: string;
  maxMonth: string;
  isOwner: boolean;
  currencySymbol: string;
}) {
  const tiles = [
    { label: "Present", value: summary.present },
    { label: "Absent", value: summary.absent },
    { label: "Half day", value: summary.halfDay },
    { label: "Holiday", value: summary.holiday },
    { label: "Leave (paid / unpaid)", value: `${summary.leavePaid} / ${summary.leaveUnpaid + summary.leavePending}` },
  ];
  const offDays = records.filter((r) => r.status !== "PRESENT");
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg">Attendance · {formatMonth(month)}</h2>
        <MonthPicker month={month} max={maxMonth} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-3 shadow-xs">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-medium">
          {isOwner
            ? `Pay cut: ${summary.cutDays ? `${summary.cutDays} day${summary.cutDays === 1 ? "" : "s"} × ${formatMoney(summary.perDay, currencySymbol)} = − ${formatMoney(summary.deduction, currencySymbol)}` : "none"}`
            : `Days cut from pay: ${summary.cutDays || "none"}`}
        </span>
        <span className="block text-xs text-muted-foreground">
          {cutBreakdown(summary)}. {isOwner ? `One day = salary ÷ ${summary.daysInMonth} days in ${formatMonth(month)}. ` : ""}One holiday a week is not cut.
          {summary.notMarked ? ` ${summary.notMarked} day${summary.notMarked === 1 ? " is" : "s are"} not marked (not cut).` : ""}
        </span>
      </p>
      {offDays.length ? (
        <ul className="divide-y rounded-2xl border bg-card shadow-xs">
          {offDays.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
              <span className="w-32 shrink-0 tabular-nums">{dayWithWeekday(r.date)}</span>
              <StatusChip status={r.status} leavePaid={r.leavePaid} />
              <span className="text-xs text-muted-foreground">by {r.markedByName}</span>
              {isOwner && r.status === "LEAVE" ? (
                <span className="ml-auto">
                  <LeaveDecision attendanceId={r.id} leavePaid={r.leavePaid} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
          {records.length ? "Present on every marked day." : `No attendance marked in ${formatMonth(month)}.`}
        </p>
      )}
    </section>
  );
}
