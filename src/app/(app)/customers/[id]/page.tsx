import { notFound } from "next/navigation";
import { MapPin, Phone, ReceiptText, MessageCircle } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError } from "@/server/core";
import { customerCategories, getCustomerForActor, partySummary } from "@/server/services/parties";
import { partyStatement } from "@/server/services/khata";
import { listSales } from "@/server/services/sales";
import { listMessages } from "@/server/services/whatsapp";
import { can } from "@/server/core";
import { PageHeader } from "@/components/page";
import { RangeFilter } from "@/components/filters";
import { Avatar, Badge, Card, CardHeader, Money } from "@/components/ui";
import { LedgerTable, type LedgerRow } from "@/components/ledger";
import { CustomerActions } from "../client";
import Link from "next/link";
import { displayPhone } from "@/lib/utils";
import { formatDate, formatDateTime, resolveRange } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  let customer;
  try {
    customer = await getCustomerForActor(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const range = sp.range ? resolveRange(sp) : null;
  const party = { type: "CUSTOMER" as const, id };
  const [summary, statement, categories] = await Promise.all([partySummary(db, party), can(actor, "ledger.view") ? partyStatement(db, actor, party, range ?? {}) : null, customerCategories(db)]);
  const sales = can(actor, "sales.view") ? await listSales(db, actor, { customerId: id, limit: 8 }) : null;
  const messages = can(actor, "messages.send") ? await listMessages(db, actor, { partyType: "CUSTOMER", partyId: id, limit: 6 }) : [];
  const bal = summary.balance;
  const rows: LedgerRow[] = (statement?.rows ?? []).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={customer.name} className="size-10 text-sm" tone={bal > 0 ? "get" : bal < 0 ? "give" : "neutral"} />
            <span>
              {customer.name}
              {customer.archivedAt ? <Badge tone="warn" className="ml-2 align-middle">Archived</Badge> : null}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{customer.code}</span>
            {customer.mobile ? (
              <a href={`tel:${customer.mobile}`} className="inline-flex items-center gap-1 hover:text-fg">
                <Phone className="size-3.5" /> {displayPhone(customer.mobile)}
              </a>
            ) : null}
            {customer.address ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {customer.address}
              </span>
            ) : null}
            {customer.gstin ? <span>GSTIN {customer.gstin}</span> : null}
            <Badge>{customer.category}</Badge>
          </span>
        }
        actions={<CustomerActions customer={customer} balance={bal} categories={categories} canDelete={summary.lastTxn === null && can(actor, "customers.archive")} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card className={`p-4 ${bal > 0 ? "border-get/30" : bal < 0 ? "border-give/30" : ""}`}>
              <div className="text-xs text-muted">{bal > 0 ? "You'll get" : bal < 0 ? "You'll give" : "Balance"}</div>
              <Money value={bal} tone="auto" abs className="mt-1 block text-lg font-semibold sm:text-2xl" />
              <div className="text-[11px] text-subtle">{bal === 0 ? "Settled" : bal > 0 ? "Customer owes you" : "Advance held"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Total given</div>
              <Money value={summary.given} className="mt-1 block text-lg font-semibold sm:text-2xl" />
              <div className="text-[11px] text-subtle">Goods & credit</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Total received</div>
              <Money value={summary.received} className="mt-1 block text-lg font-semibold sm:text-2xl" />
              <div className="text-[11px] text-subtle">{summary.lastPayment ? `Last ${formatDate(summary.lastPayment)}` : "No payments yet"}</div>
            </Card>
          </div>

          {statement ? (
            <Card>
              <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="px-1 text-[15px] font-semibold">Khata statement</h2>
                <RangeFilter defaultRange="" presets={["30d", "month", "prev_month", "fy", "custom"]} />
              </div>
              <LedgerTable rows={rows} partyType="CUSTOMER" opening={statement.opening} partyPath={`/customers/${id}`} />
              <div className="flex justify-between border-t border-border px-4 py-3 text-sm">
                <span className="font-medium">Closing balance</span>
                <Money value={statement.closing} tone="auto" abs className="font-semibold" />
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4">
          {sales ? (
            <Card>
              <CardHeader title="Invoices" action={<Link href={`/sales?q=${encodeURIComponent(customer.name)}`} className="text-xs font-medium text-brand">All</Link>} />
              {sales.rows.length ? (
                <ul className="divide-y divide-border px-1 py-2">
                  {sales.rows.map((s) => (
                    <li key={s.id}>
                      <Link href={`/sales/${s.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-surface-2">
                        <span>
                          <span className="block text-sm font-medium">{s.invoiceNo}</span>
                          <span className="text-xs text-muted">{formatDate(s.saleDate)}</span>
                        </span>
                        <span className="text-right">
                          <span className="tnum block text-sm font-medium">{formatINR(s.grand)}</span>
                          <Badge tone={s.payStatus === "PAID" ? "give" : s.payStatus === "CANCELLED" ? "neutral" : s.payStatus === "PARTIAL" ? "warn" : "get"}>{s.payStatus.toLowerCase()}</Badge>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted">
                  <ReceiptText className="size-4" /> No invoices yet
                </p>
              )}
            </Card>
          ) : null}
          {can(actor, "messages.send") ? (
            <Card>
              <CardHeader title="WhatsApp history" />
              {messages.length ? (
                <ul className="space-y-2 px-4 py-3">
                  {messages.map((m) => (
                    <li key={m.id} className="rounded-lg bg-surface-2 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{m.messageType.replace(/_/g, " ").toLowerCase()}</span>
                        <Badge tone={m.status === "FAILED" ? "get" : m.status === "DELIVERED" || m.status === "READ" ? "give" : m.status === "MANUAL_OPENED" ? "neutral" : "info"}>{m.status === "MANUAL_OPENED" ? "opened in app" : m.status.toLowerCase()}</Badge>
                      </div>
                      <div className="mt-1 text-muted">
                        {formatDateTime(m.createdAt)} · {m.by}
                      </div>
                      {m.error ? <div className="mt-1 text-get">{m.error}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted">
                  <MessageCircle className="size-4" /> No messages sent yet
                </p>
              )}
            </Card>
          ) : null}
          {customer.notes ? (
            <Card className="p-4 text-sm">
              <div className="mb-1 text-xs font-medium text-muted">Notes</div>
              {customer.notes}
            </Card>
          ) : null}
        </aside>
      </div>
      <div className="h-20 lg:hidden" />
    </>
  );
}
