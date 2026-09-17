import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { EmployeeForm } from "@/components/app/employee-form";

export const metadata: Metadata = { title: "Add Employee" };

export default async function NewEmployeePage() {
  await requirePermissionPage("employee.manage");
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/employees" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All employees
      </Link>
      <PageHeader title="Add Employee" description="Save the details now; Aadhaar documents and salary payments are added from the employee page." />
      <EmployeeForm currencySymbol={settings.currencySymbol} />
    </div>
  );
}
