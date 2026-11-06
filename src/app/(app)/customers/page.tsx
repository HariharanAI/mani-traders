import Link from "next/link";
import { Users } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { customerCategories, customerTotals, listCustomers } from "@/server/services/parties";
import { PageHeader, StatCard, BalanceLabel } from "@/components/page";
import { Pagination, SearchBox, SelectFilter } from "@/components/filters";
import { Avatar, Card, EmptyState, Money, Table, Badge } from "@/components/ui";
import { AddCustomerButton } from "./client";
import { displayPhone } from "@/lib/utils";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Customers" };
const PAGE = 30;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("customers.view");
  const sp = await searchParams;
  const db = await getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, totals, categories] = await Promise.all([
    listCustomers(db, actor, { q: sp.q, status: (sp.status as never) ?? "all", category: sp.category, archived: sp.view === "archived", sort: (sp.sort as never) ?? "recent", limit: PAGE, offset: (page - 1) * PAGE }),
    customerTotals(db, actor),
    customerCategories(db),
  ]);
  return (
    <>
      <PageHeader title="Customers" description="Every customer's khata, balance and history" actions={<AddCustomerButton categories={categories} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="You'll get" value={totals.receivable} tone="get" hint={`${totals.owing} customers owe you`} href="/customers?status=owes" />
        <StatCard label="You'll give (advances)" value={totals.advance} tone="give" href="/customers?status=advance" />
        <StatCard label="Active customers" value={totals.count} money={false} className="col-span-2 sm:col-span-1" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <SearchBox placeholder="Search name, mobile or ID" className="sm:max-w-xs sm:flex-1" />
          <div className="flex flex-wrap gap-2">
            <SelectFilter param="status" label="Balance" options={[{ value: "", label: "All balances" }, { value: "owes", label: "Customer owes us" }, { value: "advance", label: "We owe customer" }, { value: "settled", label: "Settled" }]} />
            <SelectFilter param="category" label="Category" options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]} />
            <SelectFilter param="sort" label="Sort" options={[{ value: "", label: "Recent activity" }, { value: "name", label: "Name A–Z" }, { value: "balance", label: "Highest balance" }]} />
            <SelectFilter param="view" label="View" options={[{ value: "", label: "Active" }, { value: "archived", label: "Archived" }]} />
          </div>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={Users} title={sp.q || sp.status ? "No customers match" : "No customers yet"} description={sp.q || sp.status ? "Try a different search or filter." : "Add your first customer to start their digital khata."} action={!sp.q ? <AddCustomerButton categories={categories} /> : undefined} />
        ) : (
          <>
            {/* mobile list */}
            <ul className="divide-y divide-border sm:hidden">
              {list.rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <Avatar name={c.name} tone={c.balance > 0 ? "get" : c.balance < 0 ? "give" : "neutral"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">{c.lastTxn ? `Last entry ${formatDate(c.lastTxn)}` : displayPhone(c.mobile)}</span>
                    </span>
                    <span className="text-right">
                      <Money value={c.balance} tone="auto" abs className="block font-semibold" />
                      <BalanceLabel value={c.balance} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {/* desktop table */}
            <Table className="hidden sm:block">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="!text-right">Total given</th>
                  <th className="!text-right">Total received</th>
                  <th className="!text-right">Balance</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/customers/${c.id}`} className="flex items-center gap-3">
                        <Avatar name={c.name} className="size-8" tone={c.balance > 0 ? "get" : c.balance < 0 ? "give" : "neutral"} />
                        <span className="min-w-0">
                          <span className="block font-medium hover:underline">{c.name}</span>
                          <span className="block text-xs text-muted">
                            {c.code} · {displayPhone(c.mobile)} {c.category !== "Regular" ? <Badge className="ml-1">{c.category}</Badge> : null}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-right">
                      <Money value={c.given} className="text-muted" />
                    </td>
                    <td className="text-right">
                      <Money value={c.received} className="text-muted" />
                    </td>
                    <td className="text-right">
                      <Money value={c.balance} tone="auto" abs className="font-semibold" />
                      <div>
                        <BalanceLabel value={c.balance} />
                      </div>
                    </td>
                    <td className="text-muted">{c.lastTxn ? formatDate(c.lastTxn) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={list.total} pageSize={PAGE} page={page} />
          </>
        )}
      </Card>
    </>
  );
}
