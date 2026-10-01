import Link from "next/link";
import { ChevronRight, Contact, FileBadge } from "lucide-react";
import type { EmployeeBasicDTO, EmployeeListItem, EmployeeStatusFilter } from "@/lib/services/employees";
import { fromPaise, toPaise } from "@/lib/money";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { cn } from "@/lib/utils";

function StatusChip({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 uppercase dark:bg-emerald-500/10 dark:text-emerald-300">Active</span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 uppercase dark:bg-red-500/10 dark:text-red-300">Inactive</span>
  );
}

export function EmployeeList({ employees, currencySymbol, query, status }: { employees: EmployeeListItem[]; currencySymbol: string; query?: string; status: EmployeeStatusFilter }) {
  if (employees.length === 0) {
    return (
      <EmptyState
        icon={Contact}
        title={query ? `No employees match “${query}”` : status === "inactive" ? "No inactive employees" : "No employees yet"}
        description={query ? "Check the spelling or clear the search." : "Add the people working in your shop to keep their details, Aadhaar and salary records in one place."}
        action={
          !query ? (
            <Button render={<Link href="/employees/new" />} size="lg">
              Add an employee
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
        {employees.map((e) => (
          <li key={e.id}>
            <Link href={`/employees/${e.id}`} className={cn("block rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md", !e.isActive && "opacity-75")}>
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{e.name.charAt(0).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span className="truncate">{e.name}</span>
                    <StatusChip active={e.isActive} />
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {e.designation ?? "Staff"}
                    {e.phone ? ` · ${e.phone}` : ""}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 flex items-end justify-between text-sm">
                <span className="text-muted-foreground">{e.joinedAt ? `Joined ${formatDate(e.joinedAt)}` : "Joining date not set"}</span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{formatMoney(e.monthlySalary, currencySymbol)}<span className="text-xs font-normal text-muted-foreground">/mo</span></span>
                  {toPaise(e.absenceCutThisMonth) > 0 ? (
                    <span className="block text-xs text-destructive tabular-nums">
                      − {formatMoney(e.absenceCutThisMonth, currencySymbol)} for {e.cutDaysThisMonth} day{e.cutDaysThisMonth === 1 ? "" : "s"} off
                    </span>
                  ) : null}
                  {toPaise(e.advancesThisMonth) > 0 ? <span className="block text-xs text-amber-700 tabular-nums dark:text-amber-300">Took {formatMoney(e.advancesThisMonth, currencySymbol)} this month</span> : null}
                  {e.monthlySalary && (toPaise(e.absenceCutThisMonth) > 0 || toPaise(e.advancesThisMonth) > 0) ? (
                    <span className="block text-xs font-medium tabular-nums">To pay {formatMoney(toPay(e), currencySymbol)}</span>
                  ) : null}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-xs lg:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[960px]">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="pl-4">Employee</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Monthly salary</TableHead>
                <TableHead className="text-right">Cut for days off</TableHead>
                <TableHead className="text-right">Advances</TableHead>
                <TableHead className="text-right">To pay this month</TableHead>
                <TableHead>Documents</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id} className={cn(!e.isActive && "text-muted-foreground")}>
                  <TableCell className="pl-4">
                    <Link href={`/employees/${e.id}`} className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{e.name.charAt(0).toUpperCase()}</span>
                      <span className="block max-w-[260px] truncate font-medium text-foreground hover:text-primary">{e.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{e.designation ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{e.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{e.joinedAt ? formatDate(e.joinedAt) : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(e.monthlySalary, currencySymbol)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {toPaise(e.absenceCutThisMonth) > 0 ? (
                      <span className="text-destructive">
                        − {formatMoney(e.absenceCutThisMonth, currencySymbol)}
                        <span className="block text-xs text-muted-foreground">
                          {e.cutDaysThisMonth} day{e.cutDaysThisMonth === 1 ? "" : "s"}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{toPaise(e.advancesThisMonth) > 0 ? `− ${formatMoney(e.advancesThisMonth, currencySymbol)}` : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{e.monthlySalary ? formatMoney(toPay(e), currencySymbol) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    <span className="inline-flex items-center gap-1">
                      <FileBadge className="size-3.5 text-muted-foreground" /> {e.documentCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusChip active={e.isActive} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" variant="outline" render={<Link href={`/employees/${e.id}`} />}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}

/** Salary − attendance cut − advances, for this month so far. */
function toPay(e: EmployeeListItem) {
  return fromPaise(toPaise(e.monthlySalary) - toPaise(e.absenceCutThisMonth) - toPaise(e.advancesThisMonth));
}

/** The manager's list: names only, each opening the page where advances are noted. */
export function EmployeeBasicList({ employees, query }: { employees: EmployeeBasicDTO[]; query?: string }) {
  if (employees.length === 0) {
    return <EmptyState icon={Contact} title={query ? `No employees match “${query}”` : "No employees yet"} description={query ? "Check the spelling or clear the search." : "The owner adds employees."} />;
  }
  return (
    <ul className="divide-y rounded-2xl border bg-card shadow-xs">
      {employees.map((e) => (
        <li key={e.id}>
          <Link href={`/employees/${e.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{e.name.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{e.name}</span>
              <span className="block truncate text-sm text-muted-foreground">
                {e.designation ?? "Staff"}
                {e.phone ? ` · ${e.phone}` : ""}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
