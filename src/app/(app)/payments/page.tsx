import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { listPayments } from "@/server/services/payments";
import { PageHeader, StatCard } from "@/components/page";
import { Pagination, RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Card, EmptyState, Money, Table } from "@/components/ui";
import { PaymentButtons } from "./client";
import { formatDate, resolveRange } from "@/lib/dates";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { redirect } from "next/navigation";

export const metadata = { title: "Payments" };
const PAGE = 40;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage();
  if (!can(actor, "payments.receive") && !can(actor, "payments.make")) redirect("/forbidden");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "30d");
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await listPayments(db, actor, {
    direction: sp.direction === "IN" || sp.direction === "OUT" ? sp.direction : undefined,
    method: PAYMENT_METHODS.includes(sp.method as PaymentMethod) ? (sp.method as PaymentMethod) : undefined,
    partyType: !can(actor, "suppliers.view") ? "CUSTOMER" : undefined,
    from: range.from,
    to: range.to,
    q: sp.q,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  return (
    <>
      <PageHeader title="Payments" description="Money received and paid, with receipts" actions={<PaymentButtons />} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={`Received · ${range.label}`} value={list.inSum} tone="give" icon={ArrowDownLeft} />
        <StatCard label={`Paid out · ${range.label}`} value={list.outSum} tone="get" icon={ArrowUpRight} />
        <StatCard label="Net" value={list.inSum - list.outSum} className="col-span-2 sm:col-span-1" hint="Excludes reversed payments" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchBox placeholder="Receipt no., reference, party" className="sm:max-w-xs sm:flex-1" />
          <RangeFilter defaultRange="30d" />
          <SelectFilter param="direction" options={[{ value: "", label: "In & out" }, { value: "IN", label: "Received" }, { value: "OUT", label: "Paid" }]} />
          <SelectFilter param="method" options={[{ value: "", label: "All methods" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))]} />
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No payments in this period" description="Payments recorded from the khata, invoices or here appear in this list." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Party</th>
                  <th className="hidden md:table-cell">Method</th>
                  <th className="!text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/payments/${p.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <span className={`grid size-6 place-items-center rounded-full ${p.direction === "IN" ? "bg-give-soft text-give" : "bg-get-soft text-get"}`}>{p.direction === "IN" ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}</span>
                        {p.paymentNo}
                      </Link>
                      <div className="pl-8 text-xs text-muted">
                        {formatDate(p.paymentDate)} · {p.createdByName}
                      </div>
                    </td>
                    <td>
                      {p.partyId ? (
                        <Link href={`/${p.partyType === "CUSTOMER" ? "customers" : "suppliers"}/${p.partyId}`} className="hover:underline">
                          {p.partyName}
                        </Link>
                      ) : (
                        <span className="text-muted">{p.partyName}</span>
                      )}
                      {p.partyType === "SUPPLIER" ? <Badge className="ml-1.5">Supplier</Badge> : null}
                    </td>
                    <td className="hidden text-muted md:table-cell">
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.referenceNo ? <div className="text-xs">Ref {p.referenceNo}</div> : null}
                    </td>
                    <td className="text-right">
                      <Money value={p.amountP} tone={p.direction === "IN" ? "give" : "get"} className={p.status !== "ACTIVE" ? "line-through opacity-50" : "font-semibold"} />
                      {p.status !== "ACTIVE" ? <div><Badge tone="warn">Reversed</Badge></div> : null}
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
