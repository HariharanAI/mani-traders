import Link from "next/link";
import { Plus, ShoppingCart } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { listSales } from "@/server/services/sales";
import { PageHeader, StatCard } from "@/components/page";
import { Pagination, RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Button, Card, EmptyState, Money, Table } from "@/components/ui";
import { formatDate, resolveRange } from "@/lib/dates";

export const metadata = { title: "Sales" };
const PAGE = 30;
const PAY_TONE = { PAID: "give", PARTIAL: "warn", UNPAID: "get", CANCELLED: "neutral" } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("sales.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "30d");
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listSales(db, actor, { q: sp.q, from: range.from, to: range.to, status: (sp.status as never) ?? "all", limit: PAGE, offset: (page - 1) * PAGE });
  return (
    <>
      <PageHeader
        title="Sales"
        description="Invoices, cash and credit sales"
        actions={
          can(actor, "sales.create") ? (
            <Link href="/sales/new">
              <Button>
                <Plus /> New sale
              </Button>
            </Link>
          ) : null
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={`Billed · ${range.label}`} value={list.amount} tone="brand" hint="Incl. GST, excl. cancelled" />
        <StatCard label="Still due on these invoices" value={list.due} tone="get" />
        <StatCard label="Invoices" value={list.total} money={false} className="col-span-2 sm:col-span-1" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchBox placeholder="Invoice no., customer, mobile" className="sm:max-w-xs sm:flex-1" />
          <RangeFilter defaultRange="30d" />
          <SelectFilter param="status" options={[{ value: "", label: "All invoices" }, { value: "paid", label: "Paid" }, { value: "partial", label: "Partly paid" }, { value: "unpaid", label: "Unpaid" }, { value: "cancelled", label: "Cancelled" }]} />
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No sales in this period" description="Create a sale to generate an invoice and update stock and khata automatically." action={can(actor, "sales.create") ? <Link href="/sales/new"><Button><Plus /> New sale</Button></Link> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th className="!text-right">Amount</th>
                  <th className="hidden !text-right md:table-cell">Paid</th>
                  <th className="!text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/sales/${s.id}`} className="font-medium hover:underline">
                        {s.invoiceNo}
                      </Link>
                      <div className="text-xs text-muted">
                        {formatDate(s.saleDate)} · {s.by}
                      </div>
                    </td>
                    <td>
                      {s.customerId ? (
                        <Link href={`/customers/${s.customerId}`} className="hover:underline">
                          {s.customerName}
                        </Link>
                      ) : (
                        <span className="text-muted">{s.customerName}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Money value={s.grand} className={s.status === "CANCELLED" ? "line-through opacity-50" : "font-medium"} />
                    </td>
                    <td className="hidden text-right md:table-cell">
                      <Money value={s.paid} className="text-muted" />
                    </td>
                    <td className="text-right">
                      <Badge tone={PAY_TONE[s.payStatus as keyof typeof PAY_TONE]}>{s.payStatus === "PARTIAL" ? "Partial" : s.payStatus.toLowerCase()}</Badge>
                      {s.due > 0 && s.status === "ACTIVE" ? <div className="tnum mt-0.5 text-xs text-get">Due <Money value={s.due} /></div> : null}
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
