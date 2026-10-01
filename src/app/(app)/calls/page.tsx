import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, CheckCheck, PhoneCall, Store } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { parsePaging } from "@/lib/paging";
import { CALLS_TABS, callsTabCounts, listEnquiries, type CallsTab } from "@/lib/services/enquiries";
import { PageHeader } from "@/components/app/page-header";
import { AddNumbersBox, EnquiryList } from "@/components/app/calls-manager";
import { OrderSearch } from "@/components/app/order-search";
import { Pagination } from "@/components/app/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calls" };

const TABS: Record<CallsTab, { label: string; icon: React.ComponentType<{ className?: string }>; empty: string }> = {
  today: { label: "To call today", icon: PhoneCall, empty: "Nobody to call right now. Add numbers above when new enquiries come in." },
  coming: { label: "Coming", icon: Store, empty: "Nobody has said they are coming yet." },
  later: { label: "Call later", icon: CalendarClock, empty: "No calls planned for later days." },
  closed: { label: "Closed", icon: CheckCheck, empty: "Customers who visited or were not interested appear here." },
};

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string; size?: string }> }) {
  const user = await requirePermissionPage("enquiry.manage");
  const params = await searchParams;
  const tab: CallsTab = CALLS_TABS.includes(params.tab as CallsTab) ? (params.tab as CallsTab) : "today";
  const [counts, result] = await Promise.all([callsTabCounts(user), listEnquiries({ tab, search: params.q, ...parsePaging(params) }, user)]);

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
      active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-5">
      <PageHeader title="Calls" description="New customer enquiries to phone. Add the number, tap it to call, then note what they said." />

      <AddNumbersBox />

      <nav aria-label="Call lists" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:gap-0">
        {CALLS_TABS.map((t) => {
          const Icon = TABS[t].icon;
          return (
            <Link key={t} href={t === "today" ? "/calls" : `/calls?tab=${t}`} className={tabClass(t === tab)} aria-current={t === tab ? "page" : undefined}>
              <Icon className="size-4" /> {TABS[t].label}
              <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">{counts[t]}</span>
            </Link>
          );
        })}
      </nav>

      <Suspense>
        <OrderSearch placeholder="Search name, number or what they asked about..." />
      </Suspense>

      <EnquiryList enquiries={result.items} emptyText={params.q ? "No one matches this search." : TABS[tab].empty} />
      <Suspense>
        <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
      </Suspense>
    </div>
  );
}
