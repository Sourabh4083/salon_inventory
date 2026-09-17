import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getEmployee } from "@/lib/services/employees";
import { PageHeader } from "@/components/app/page-header";
import { EmployeeForm } from "@/components/app/employee-form";

export const metadata: Metadata = { title: "Edit Employee" };
export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage("employee.manage");
  const { id } = await params;
  const [settings, detail] = await Promise.all([getSettings(), getEmployee(id, user)]);
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/employees/${id}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to {detail.employee.name}
      </Link>
      <PageHeader title="Edit Employee" description="Update personal details, Aadhaar number or the agreed monthly salary." />
      <EmployeeForm currencySymbol={settings.currencySymbol} employee={detail.employee} />
    </div>
  );
}
