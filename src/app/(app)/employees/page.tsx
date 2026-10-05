import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { can } from "@/lib/permissions";
import { parsePaging } from "@/lib/paging";
import { getSettings } from "@/lib/services/settings";
import { listEmployees, listEmployeesBasic, type EmployeeStatusFilter } from "@/lib/services/employees";
import { PageHeader } from "@/components/app/page-header";
import { EmployeeFilters } from "@/components/app/employee-filters";
import { EmployeeBasicList, EmployeeList } from "@/components/app/employee-list";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { Pagination } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Employees" };

const STATUSES = new Set<EmployeeStatusFilter>(["active", "inactive", "all"]);

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; size?: string }> }) {
  const user = await requirePermissionPage("employee.view");
  const params = await searchParams;
  const paging = parsePaging(params);

  if (!can(user.role, "employee.manage")) {
    const result = await listEmployeesBasic({ q: params.q, ...paging }, user);
    return (
      <div className="space-y-5">
        <PageHeader title="Employees" description="Open an employee to see their attendance or note money they take from the shop today." />
        <Suspense>
          <EmployeeFilters showStatus={false} />
        </Suspense>
        <EmployeeBasicList employees={result.items} query={params.q} />
        <Suspense>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
        </Suspense>
      </div>
    );
  }

  const status = STATUSES.has(params.status as EmployeeStatusFilter) ? (params.status as EmployeeStatusFilter) : "active";
  const [settings, result] = await Promise.all([getSettings(), listEmployees({ q: params.q, status, ...paging }, user)]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Staff details, Aadhaar documents, advances and salary records. The manager sees only names and attendance, and can note advances."
        actions={
          <>
            <DownloadExcelButton kind="salaries" label="Salaries & advances" />
            <Button size="lg" className="h-11" render={<Link href="/employees/new" />}>
              <UserPlus /> Add Employee
            </Button>
          </>
        }
      />
      <Suspense>
        <EmployeeFilters />
      </Suspense>
      <EmployeeList employees={result.items} currencySymbol={settings.currencySymbol} query={params.q} status={status} />
      <Suspense>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
      </Suspense>
    </div>
  );
}
