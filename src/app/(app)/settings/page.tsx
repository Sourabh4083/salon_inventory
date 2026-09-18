import type { Metadata } from "next";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { listCategories } from "@/lib/services/products";
import { listAuditLogs } from "@/lib/services/audit";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/app/settings-form";
import { CategoryManager } from "@/components/app/category-manager";
import { ServicesManager } from "@/components/app/services-manager";
import { listServices } from "@/lib/services/billing";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermissionPage("settings.manage");
  const [settings, categories, services, audit] = await Promise.all([getSettings(), listCategories(), listServices(), listAuditLogs(30)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Business details and the shop-wide low-stock rule." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsForm settings={settings} />
        <CategoryManager categories={categories} />
      </div>
      <ServicesManager services={services} currencySymbol={settings.currencySymbol} />
      <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
        <h2 className="font-heading text-lg">Audit log</h2>
        <p className="mt-1 text-sm text-muted-foreground">Important account and product events (latest 30).</p>
        {audit.length ? (
          <ul className="mt-4 divide-y text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="min-w-0">
                  <span className="font-medium">{a.actor?.name ?? "System"}</span>
                  <span className="text-muted-foreground"> · {a.summary}</span>
                </span>
                <time className="shrink-0 text-xs whitespace-nowrap text-muted-foreground" dateTime={a.createdAt.toISOString()}>
                  {formatDateTime(a.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No events recorded yet.</p>
        )}
      </section>
    </div>
  );
}
