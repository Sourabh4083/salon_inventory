import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermissionPage } from "@/lib/auth/guards";
import { can } from "@/lib/permissions";
import { parsePaging } from "@/lib/paging";
import { getSettings } from "@/lib/services/settings";
import { listExpenses } from "@/lib/services/expenses";
import { formatDate, formatMoney } from "@/lib/format";
import { resolveRange, toDateParam } from "@/lib/dates";
import { PageHeader } from "@/components/app/page-header";
import { ReportRangePicker } from "@/components/app/report-range-picker";
import { ExpenseForm, ExpenseList } from "@/components/app/expense-manager";
import { DownloadExcelButton } from "@/components/app/download-excel-button";
import { Pagination } from "@/components/app/pagination";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; page?: string; size?: string }> }) {
  const user = await requirePermissionPage("expense.record");
  const params = await searchParams;
  const isOwner = can(user.role, "expense.manage");
  const range = resolveRange(params);
  const [settings, result] = await Promise.all([getSettings(), listExpenses({ from: range.from, to: range.to, ...parsePaging(params) }, user)]);
  const sym = settings.currencySymbol;
  const sameDay = toDateParam(range.from) === toDateParam(range.to);
  const rangeLabel = !isOwner || range.key === "today" ? "today" : sameDay ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Expenses"
        description={isOwner ? "Money the shop spends each day: tea, cleaning, electricity and so on." : "Note money spent from the shop today. The owner sees the totals."}
        actions={isOwner ? <DownloadExcelButton kind="expenses" /> : undefined}
      />

      <ExpenseForm isOwner={isOwner} currencySymbol={sym} />

      {isOwner ? <ReportRangePicker active={range.key} from={toDateParam(range.from)} to={toDateParam(range.to)} /> : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading text-lg">Spent {rangeLabel}</h2>
          {isOwner ? <p className="text-2xl font-semibold tabular-nums">{formatMoney(result.amount, sym)}</p> : null}
        </div>
        <ExpenseList expenses={result.items} currencySymbol={sym} emptyText={isOwner ? "No expenses in this period." : "Nothing noted today."} />
        <Suspense>
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} />
        </Suspense>
      </section>
    </div>
  );
}
