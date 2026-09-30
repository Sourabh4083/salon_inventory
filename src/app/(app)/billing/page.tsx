import type { Metadata } from "next";
import { parsePaging } from "@/lib/paging";
import Link from "next/link";
import { HandCoins, Plus, ReceiptText } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { getSettings } from "@/lib/services/settings";
import { getOutstanding, listBills } from "@/lib/services/billing";
import type { BillStatus } from "@/generated/prisma/enums";
import { resolveRange } from "@/lib/dates";
import { formatMoney, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { BillFilters } from "@/components/app/bill-filters";
import { BillPaymentStatus, BillStatusBadge } from "@/components/app/bill-badges";
import { Pagination } from "@/components/app/pagination";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Bills" };

const STATUSES = new Set<BillStatus>(["COMPLETED", "CANCELLED"]);

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; range?: string; page?: string; size?: string }> }) {
  const user = await requirePermissionPage("bill.view");
  const params = await searchParams;
  const unpaid = params.status === "UNPAID";
  const status = STATUSES.has(params.status as BillStatus) ? (params.status as BillStatus) : undefined;
  const range = params.range ? resolveRange({ range: params.range }) : null;
  const [settings, result, outstanding] = await Promise.all([
    getSettings(),
    listBills({ search: params.q, status, unpaid, from: range?.from, to: range?.to, ...parsePaging(params) }),
    getOutstanding(),
  ]);
  const sym = settings.currencySymbol;
  const filtered = Boolean(params.q || status || unpaid || range);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bills"
        description="Every customer bill, newest first."
        actions={
          <>
            {can(user.role, "data.export") ? <DownloadExcelButton kind="bills" /> : null}
            <Button size="lg" className="h-11" render={<Link href="/billing/new" />}>
              <Plus /> New Bill
            </Button>
          </>
        }
      />
      <BillFilters />

      {outstanding.count > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
          <HandCoins className="size-4.5 shrink-0" />
          <span className="flex-1">
            <span className="font-semibold tabular-nums">{formatMoney(outstanding.amount, sym)}</span> still to collect from {outstanding.count}{" "}
            {outstanding.count === 1 ? "unpaid bill" : "unpaid bills"}
            {unpaid ? " · oldest first" : ""}.
          </span>
          {unpaid ? null : (
            <Link href="/billing?status=UNPAID" className="font-medium underline underline-offset-2">
              View unpaid
            </Link>
          )}
        </div>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={filtered ? "No bills match these filters" : "No bills yet"}
          description={filtered ? "Try a different search or date range." : "Create the first bill when a customer pays."}
          action={
            filtered ? null : (
              <Button size="lg" render={<Link href="/billing/new" />}>
                <Plus /> New Bill
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {result.items.map((b) => (
              <li key={b.id}>
                <Link href={`/billing/${b.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {b.billNumber} <BillStatusBadge status={b.status} />
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {b.customerName ?? "Walk-in customer"} · {b.itemCount} {b.itemCount === 1 ? "item" : "items"} · {formatRelative(b.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(b.total, sym)}</p>
                    <BillPaymentStatus bill={b} currencySymbol={sym} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-xs md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Bill</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Billed by</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.items.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/billing/${b.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        {b.billNumber} <BillStatusBadge status={b.status} />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {b.customerName ?? <span className="text-muted-foreground">Walk-in</span>}
                      {b.customerPhone ? <span className="block text-xs text-muted-foreground">{b.customerPhone}</span> : null}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <span className="block truncate text-muted-foreground">{b.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(", ")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <BillPaymentStatus bill={b} currencySymbol={sym} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{b.createdByName}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatRelative(b.createdAt)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(b.total, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
        </>
      )}
    </div>
  );
}
