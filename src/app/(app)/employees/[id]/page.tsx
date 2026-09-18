import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, CalendarDays, FileBadge, Mail, MapPin, Phone } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getEmployee } from "@/lib/services/employees";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { EmployeeDetailActions } from "@/components/app/employee-detail-actions";
import { EmployeeDocuments } from "@/components/app/employee-documents";
import { SalaryPayments } from "@/components/app/salary-payments";
import { AadhaarNumber } from "@/components/app/aadhaar-number";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const user = await requirePermissionPage("employee.manage");
  const { id } = await params;
  const detail = await getEmployee(id, user);
  return { title: detail?.employee.name ?? "Employee" };
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermissionPage("employee.manage");
  const { id } = await params;
  const [settings, detail] = await Promise.all([getSettings(), getEmployee(id, user)]);
  if (!detail) notFound();
  const { employee, documents, payments, paidThisYear, lastPaidOn } = detail;
  const sym = settings.currencySymbol;

  const facts: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }[] = [
    { icon: Phone, label: "Phone", value: employee.phone ? <a href={`tel:${employee.phone}`} className="hover:text-primary">{employee.phone}</a> : "—" },
    { icon: Mail, label: "Email", value: employee.email ? <a href={`mailto:${employee.email}`} className="break-all hover:text-primary">{employee.email}</a> : "—" },
    { icon: MapPin, label: "Address", value: employee.address ? <span className="whitespace-pre-line">{employee.address}</span> : "—" },
    { icon: CalendarDays, label: "Joined", value: employee.joinedAt ? formatDate(employee.joinedAt) : "—" },
    { icon: CalendarDays, label: "Left", value: employee.leftAt ? formatDate(employee.leftAt) : employee.isActive ? "Still working" : "—" },
    { icon: FileBadge, label: "Aadhaar number", value: <AadhaarNumber value={employee.aadhaarNumber} /> },
    { icon: Banknote, label: "Monthly salary", value: <span className="tabular-nums">{formatMoney(employee.monthlySalary, sym)}</span> },
  ];

  return (
    <div className="space-y-6">
      <Link href="/employees" className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All employees
      </Link>

      <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">
              {employee.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="font-heading text-2xl leading-tight sm:text-3xl">{employee.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {employee.designation ?? "Staff"}
                {employee.isActive ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 uppercase dark:bg-emerald-500/10 dark:text-emerald-300">Active</span>
                ) : (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 uppercase dark:bg-red-500/10 dark:text-red-300">Inactive</span>
                )}
              </p>
            </div>
          </div>
          <EmployeeDetailActions employee={employee} />
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <f.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="mt-0.5 font-medium">{f.value}</dd>
              </div>
            </div>
          ))}
        </dl>
        {employee.notes ? (
          <div className="mt-5">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notes</p>
            <p className="mt-1 text-sm whitespace-pre-line">{employee.notes}</p>
          </div>
        ) : null}
        <p className="mt-5 text-xs text-muted-foreground">Added {formatDateTime(employee.createdAt)} · last updated {formatDateTime(employee.updatedAt)}</p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SalaryPayments employee={employee} payments={payments} paidThisYear={paidThisYear} lastPaidOn={lastPaidOn} currencySymbol={sym} />
        <EmployeeDocuments employeeId={employee.id} documents={documents} />
      </div>
    </div>
  );
}
