import Link from "next/link";
import { Truck } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listSuppliers, supplierTotals } from "@/server/services/parties";
import { PageHeader, StatCard, BalanceLabel } from "@/components/page";
import { Pagination, SearchBox, SelectFilter } from "@/components/filters";
import { Avatar, Card, EmptyState, Money, Table } from "@/components/ui";
import { AddSupplierButton } from "./client";
import { displayPhone } from "@/lib/utils";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Suppliers" };
const PAGE = 30;

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("suppliers.view");
  const sp = await searchParams;
  const db = await getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, totals] = await Promise.all([listSuppliers(db, actor, { q: sp.q, status: sp.status as never, archived: sp.view === "archived", sort: (sp.sort as never) ?? "recent", limit: PAGE, offset: (page - 1) * PAGE }), supplierTotals(db)]);
  return (
    <>
      <PageHeader title="Suppliers" description="What you owe to each supplier" actions={<AddSupplierButton />} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="You'll give (payable)" value={totals.payable} tone="give" href="/suppliers?status=owes" />
        <StatCard label="Advances paid" value={totals.advance} tone="get" href="/suppliers?status=advance" />
        <StatCard label="Suppliers" value={totals.count} money={false} className="col-span-2 sm:col-span-1" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <SearchBox placeholder="Search name, mobile, GSTIN" className="sm:max-w-xs sm:flex-1" />
          <div className="flex flex-wrap gap-2">
            <SelectFilter param="status" options={[{ value: "", label: "All balances" }, { value: "owes", label: "We owe" }, { value: "advance", label: "Advance paid" }, { value: "settled", label: "Settled" }]} />
            <SelectFilter param="sort" options={[{ value: "", label: "Recent activity" }, { value: "name", label: "Name A–Z" }, { value: "balance", label: "Highest payable" }]} />
            <SelectFilter param="view" options={[{ value: "", label: "Active" }, { value: "archived", label: "Archived" }]} />
          </div>
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={Truck} title={sp.q ? "No suppliers match" : "No suppliers yet"} description="Add suppliers to track purchases and what you owe them." action={!sp.q ? <AddSupplierButton /> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="hidden !text-right md:table-cell">Purchases</th>
                  <th className="hidden !text-right md:table-cell">Paid</th>
                  <th className="!text-right">Balance</th>
                  <th className="hidden md:table-cell">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/suppliers/${s.id}`} className="flex items-center gap-3">
                        <Avatar name={s.name} className="size-8" tone={s.balance > 0 ? "give" : s.balance < 0 ? "get" : "neutral"} />
                        <span className="min-w-0">
                          <span className="block font-medium hover:underline">{s.name}</span>
                          <span className="block text-xs text-muted">
                            {s.code} · {displayPhone(s.mobile)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden text-right md:table-cell">
                      <Money value={s.purchased} className="text-muted" />
                    </td>
                    <td className="hidden text-right md:table-cell">
                      <Money value={s.paid} className="text-muted" />
                    </td>
                    <td className="text-right">
                      <Money value={s.balance} tone="invert" abs className="font-semibold" />
                      <div>
                        <BalanceLabel value={s.balance} type="SUPPLIER" />
                      </div>
                    </td>
                    <td className="hidden text-muted md:table-cell">{s.lastTxn ? formatDate(s.lastTxn) : "—"}</td>
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
