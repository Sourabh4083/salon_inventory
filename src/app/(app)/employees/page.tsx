import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserPlus } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listEmployees, type EmployeeStatusFilter } from "@/lib/services/employees";
import { PageHeader } from "@/components/app/page-header";
import { EmployeeFilters } from "@/components/app/employee-filters";
import { EmployeeList } from "@/components/app/employee-list";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Employees" };

const STATUSES = new Set<EmployeeStatusFilter>(["active", "inactive", "all"]);

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermissionPage("employee.manage");
  const params = await searchParams;
  const status = STATUSES.has(params.status as EmployeeStatusFilter) ? (params.status as EmployeeStatusFilter) : "active";
  const [settings, employees] = await Promise.all([getSettings(), listEmployees({ q: params.q, status }, user)]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="Staff details, Aadhaar documents and salary records. Only the owner can see this page."
        actions={
          <Button size="lg" className="h-11" render={<Link href="/employees/new" />}>
            <UserPlus /> Add Employee
          </Button>
        }
      />
      <Suspense>
        <EmployeeFilters />
      </Suspense>
      <EmployeeList employees={employees} currencySymbol={settings.currencySymbol} query={params.q} status={status} />
    </div>
  );
}
