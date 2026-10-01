import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarDays, Sheet } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/services/settings";
import { MANAGER_BACKDATE_DAYS, PLAN_AHEAD_DAYS, attendanceSummaries, getDayAttendance, pendingLeaves } from "@/lib/services/attendance";
import { formatMonth, isMonthParam, parseDateParam, startOfDay, toDateParam, toMonthParam } from "@/lib/dates";
import { addDaysInZone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { AttendanceDay, AttendanceMonthTable, MonthPicker, PendingLeaves } from "@/components/app/attendance";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; month?: string }> }) {
  const user = await requirePermissionPage("attendance.mark");
  const params = await searchParams;
  const isOwner = can(user.role, "employee.manage");
  const monthView = params.view === "month";
  const today = startOfDay(new Date());

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
      active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  const header = (
    <>
      <PageHeader title="Attendance" description="Mark who came each day. Absent days and unpaid leave are cut from the salary (salary ÷ days in the month per day, half a day for a half day). One holiday a week is not cut." />
      <nav aria-label="Attendance views" className="inline-flex rounded-xl bg-muted p-1">
        <Link href="/attendance" className={tabClass(!monthView)} aria-current={!monthView ? "page" : undefined}>
          <CalendarDays className="size-4" /> Mark day
        </Link>
        <Link href="/attendance?view=month" className={tabClass(monthView)} aria-current={monthView ? "page" : undefined}>
          <Sheet className="size-4" /> Month summary
        </Link>
      </nav>
    </>
  );

  if (monthView) {
    const month = isMonthParam(params.month) && params.month <= toMonthParam() ? params.month : toMonthParam();
    const [settings, summaries] = await Promise.all([getSettings(), attendanceSummaries(month, user)]);
    return (
      <div className="space-y-5">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg">{formatMonth(month)}</h2>
          <Suspense>
            <MonthPicker month={month} max={toMonthParam()} />
          </Suspense>
        </div>
        <AttendanceMonthTable summaries={summaries} month={month} currencySymbol={settings.currencySymbol} />
        <p className="text-xs text-muted-foreground">Open an employee to see each day and, for the owner, to decide whether a leave is paid.</p>
      </div>
    );
  }

  const maxDay = addDaysInZone(today, PLAN_AHEAD_DAYS);
  const picked = parseDateParam(params.date);
  const day = picked && picked <= maxDay ? picked : today;
  const [rows, leaves] = await Promise.all([getDayAttendance(day, user), isOwner ? pendingLeaves(user) : Promise.resolve([])]);
  const canEdit = isOwner || day >= addDaysInZone(today, -MANAGER_BACKDATE_DAYS);
  const next = addDaysInZone(day, 1);

  return (
    <div className="space-y-5">
      {header}
      <PendingLeaves leaves={leaves} />
      <AttendanceDay
        day={toDateParam(day)}
        today={toDateParam(today)}
        prevDay={toDateParam(addDaysInZone(day, -1))}
        nextDay={next <= maxDay ? toDateParam(next) : null}
        maxDay={toDateParam(maxDay)}
        rows={rows}
        canEdit={canEdit}
        isOwner={isOwner}
      />
    </div>
  );
}
