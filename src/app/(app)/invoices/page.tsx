import Link from "next/link";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { Download, FileText, Receipt } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { can } from "@/server/core";
import { customerScope } from "@/server/services/parties";
import { PageHeader } from "@/components/page";
import { RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Card, EmptyState, Money, Table } from "@/components/ui";
import { formatDate, formatDateTime, resolveRange } from "@/lib/dates";
import { toPaise } from "@/lib/money";

export const metadata = { title: "Invoices & receipts" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("sales.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "30d");
  const tab = sp.tab === "receipts" ? "receipts" : "invoices";
  const scope = customerScope(actor);
  const q = sp.q?.trim();

  const invoices =
    tab === "invoices"
      ? await db
          .select({ i: s.invoices, name: s.sales.customerName })
          .from(s.invoices)
          .innerJoin(s.sales, eq(s.sales.id, s.invoices.saleId))
          .where(and(gte(s.invoices.invoiceDate, range.from), lte(s.invoices.invoiceDate, range.to), q ? or(ilike(s.invoices.invoiceNo, `%${q}%`), ilike(s.sales.customerName, `%${q}%`)) : undefined, scope ? sql`(${s.sales.createdBy} = ${actor.id} or ${s.sales.customerId} in (select id from customers where assigned_to = ${actor.id}))` : undefined))
          .orderBy(desc(s.invoices.invoiceDate), desc(s.invoices.createdAt))
          .limit(200)
      : [];
  const receipts =
    tab === "receipts" && (can(actor, "payments.receive") || can(actor, "sales.view"))
      ? await db
          .select({ r: s.receipts, p: s.payments, name: sql<string>`coalesce(${s.customers.name}, 'Walk-in customer')` })
          .from(s.receipts)
          .innerJoin(s.payments, eq(s.payments.id, s.receipts.paymentId))
          .leftJoin(s.customers, and(eq(s.payments.partyType, "CUSTOMER"), eq(s.customers.id, s.payments.partyId)))
          .where(and(gte(s.payments.paymentDate, range.from), lte(s.payments.paymentDate, range.to), q ? or(ilike(s.receipts.receiptNo, `%${q}%`), ilike(s.customers.name, `%${q}%`)) : undefined, scope ? sql`${s.customers.assignedTo} = ${actor.id}` : undefined))
          .orderBy(desc(s.payments.paymentDate), desc(s.receipts.createdAt))
          .limit(200)
      : [];

  return (
    <>
      <PageHeader title="Invoices & receipts" description="Every generated document, with unique numbering per financial year" />
      <div className="mb-3 flex gap-1 rounded-lg border border-border bg-surface-2 p-0.5 sm:w-fit">
        {(["invoices", "receipts"] as const).map((t) => (
          <Link key={t} href={`/invoices?tab=${t}`} className={`flex-1 rounded-md px-4 py-1.5 text-center text-sm font-medium ${tab === t ? "bg-surface shadow-card" : "text-muted"}`}>
            {t === "invoices" ? "Invoices" : "Payment receipts"}
          </Link>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchBox placeholder={tab === "invoices" ? "Invoice no. or customer" : "Receipt no. or customer"} className="sm:max-w-xs sm:flex-1" />
          <RangeFilter defaultRange="30d" />
          <SelectFilter param="tab" options={[{ value: "", label: "Invoices" }, { value: "receipts", label: "Receipts" }]} className="sm:hidden" />
        </div>
        {tab === "invoices" ? (
          invoices.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th className="!text-right">Amount</th>
                  <th className="hidden md:table-cell">PDF</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map(({ i, name }) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/sales/${i.saleId}`} className="font-medium hover:underline">
                        {i.invoiceNo}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(i.invoiceDate)}</div>
                    </td>
                    <td>{name}</td>
                    <td className="text-right">
                      <Money value={toPaise(i.grandTotal)} className={i.status === "CANCELLED" ? "line-through opacity-50" : "font-medium"} />
                      {i.status === "CANCELLED" ? <div><Badge>Cancelled</Badge></div> : null}
                    </td>
                    <td className="hidden text-xs text-muted md:table-cell">{i.generatedAt ? `Generated ${formatDateTime(i.generatedAt)} · ${i.downloadCount}×` : "Not generated yet"}</td>
                    <td className="text-right">
                      <a href={`/api/pdf/invoice/${i.saleId}?download=1`} className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                        <Download className="size-4" /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState icon={FileText} title="No invoices in this period" />
          )
        ) : receipts.length ? (
          <Table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Received from</th>
                <th className="!text-right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {receipts.map(({ r, p, name }) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/payments/${p.id}`} className="font-medium hover:underline">
                      {r.receiptNo}
                    </Link>
                    <div className="text-xs text-muted">{formatDate(p.paymentDate)}</div>
                  </td>
                  <td>{name}</td>
                  <td className="text-right">
                    <Money value={toPaise(p.amount)} tone="give" className={p.status !== "ACTIVE" ? "line-through opacity-50" : "font-medium"} />
                  </td>
                  <td className="text-right">
                    <a href={`/api/pdf/receipt/${p.id}?download=1`} className="inline-flex items-center gap-1 text-sm font-medium text-brand">
                      <Download className="size-4" /> PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={Receipt} title="No receipts in this period" />
        )}
      </Card>
    </>
  );
}
