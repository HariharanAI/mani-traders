import { Receipt } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listExpenses } from "@/server/services/expenses";
import { PageHeader, StatCard } from "@/components/page";
import { Pagination, RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { AddExpenseButton, ExpenseRows } from "./client";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/accounts";
import { formatINR } from "@/lib/money";
import { resolveRange } from "@/lib/dates";

export const metadata = { title: "Expenses" };
const PAGE = 40;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("expenses.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "month");
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listExpenses(db, actor, { q: sp.q, from: range.from, to: range.to, category: sp.category, method: sp.method, includeVoid: sp.void === "1", limit: PAGE, offset: (page - 1) * PAGE });
  const max = list.byCategory[0]?.amount ?? 0;
  return (
    <>
      <PageHeader title="Expenses" description="Shop running costs — kept separate from customer balances" actions={<AddExpenseButton />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label={`Expenses · ${range.label}`} value={list.amount} tone="get" icon={Receipt} />
            <StatCard label="Entries" value={list.total} money={false} />
          </div>
          <Card>
            <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
              <SearchBox placeholder="Search payee, description" className="sm:max-w-xs sm:flex-1" />
              <RangeFilter defaultRange="month" />
              <SelectFilter param="category" options={[{ value: "", label: "All categories" }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c.key, label: c.key }))]} />
              <SelectFilter param="method" options={[{ value: "", label: "All methods" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))]} />
              <SelectFilter param="void" options={[{ value: "", label: "Hide voided" }, { value: "1", label: "Include voided" }]} />
            </div>
            {list.rows.length === 0 ? <EmptyState icon={Receipt} title="No expenses in this period" description="Record rent, electricity, salaries and other costs to see true profit." action={<AddExpenseButton />} /> : <ExpenseRows rows={list.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))} />}
            <Pagination total={list.total} pageSize={PAGE} page={page} />
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="By category" description={range.label} />
          {list.byCategory.length ? (
            <ul className="space-y-3 p-5">
              {list.byCategory.map((c) => (
                <li key={c.category}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{c.category}</span>
                    <span className="tnum">{formatINR(c.amount)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">
                    <div className="h-1.5 rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.max(4, Math.round((c.amount / max) * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">No expenses yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
