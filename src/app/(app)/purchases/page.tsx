import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { listPurchases } from "@/server/services/purchases";
import { PageHeader, StatCard } from "@/components/page";
import { Pagination, RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Button, Card, EmptyState, Money, Table } from "@/components/ui";
import { formatDate, resolveRange } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export const metadata = { title: "Purchases" };
const PAGE = 30;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("purchases.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "30d");
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listPurchases(db, actor, { q: sp.q, from: range.from, to: range.to, status: sp.status, limit: PAGE, offset: (page - 1) * PAGE });
  const addBtn = can(actor, "purchases.create") ? (
    <Link href="/purchases/new">
      <Button>
        <Plus /> New purchase
      </Button>
    </Link>
  ) : null;
  return (
    <>
      <PageHeader title="Purchases" description="Stock bought from suppliers" actions={addBtn} />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <StatCard label={`Purchases · ${range.label}`} value={list.amount} tone="brand" hint="Excluding cancelled" />
        <StatCard label="Bills" value={list.total} money={false} />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchBox placeholder="Purchase no., bill no., supplier" className="sm:max-w-xs sm:flex-1" />
          <RangeFilter defaultRange="30d" />
          <SelectFilter param="status" options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "cancelled", label: "Cancelled" }]} />
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="No purchases in this period" description="Record a purchase to add stock and update the supplier's balance." action={addBtn ?? undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Supplier</th>
                  <th className="!text-right">Amount</th>
                  <th className="!text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/purchases/${p.id}`} className="font-medium hover:underline">
                        {p.purchaseNo}
                      </Link>
                      <div className="text-xs text-muted">
                        {formatDate(p.purchaseDate)}
                        {p.supplierInvoiceNo ? ` · Bill ${p.supplierInvoiceNo}` : ""}
                      </div>
                    </td>
                    <td>
                      <Link href={`/suppliers/${p.supplierId}`} className="hover:underline">
                        {p.supplierName}
                      </Link>
                    </td>
                    <td className="text-right">
                      <Money value={p.grand} className={p.status === "CANCELLED" ? "line-through opacity-50" : "font-medium"} />
                    </td>
                    <td className="text-right">
                      {p.status === "CANCELLED" ? <Badge>Cancelled</Badge> : p.due > 0 ? <Badge tone="warn">Due {formatINR(p.due, { decimals: false })}</Badge> : <Badge tone="give">Paid</Badge>}
                    </td>
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
