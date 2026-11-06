import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { customerTotals, listCustomers, supplierTotals } from "@/server/services/parties";
import { recentLedger } from "@/server/services/khata";
import { PageHeader } from "@/components/page";
import { RangeFilter, SearchBox, SelectFilter } from "@/components/filters";
import { Avatar, Badge, Card, CardHeader, EmptyState, Money } from "@/components/ui";
import { QuickKhataEntry } from "./client";
import { formatDate, formatDateTime, resolveRange } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";

export const metadata = { title: "Khata" };

const TYPE: Record<string, string> = { OPENING_BALANCE: "Opening", CREDIT_GIVEN: "Credit", SALE: "Sale", PAYMENT_IN: "Payment in", PAYMENT_OUT: "Payment out", SALES_RETURN: "Return", PURCHASE: "Purchase", PURCHASE_RETURN: "Return", ADJUSTMENT: "Adjustment", REVERSAL: "Reversal" };

export default async function KhataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("ledger.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = resolveRange(sp, "30d");
  const showSup = can(actor, "suppliers.view");
  const [ct, st, owing, feed] = await Promise.all([
    customerTotals(db, actor),
    showSup ? supplierTotals(db) : null,
    listCustomers(db, actor, { status: "owes", sort: "balance", limit: 8 }),
    recentLedger(db, actor, { limit: 100, from: range.from, to: range.to, q: sp.q, partyType: (sp.party as "CUSTOMER" | "SUPPLIER") || undefined }),
  ]);
  return (
    <>
      <PageHeader title="Khata / Ledger" description="Digital khata for every customer and supplier" actions={<QuickKhataEntry />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Card className="flex items-center justify-between p-4">
          <div>
            <div className="text-xs font-medium text-muted">You&apos;ll get · from customers</div>
            <Money value={ct.receivable} tone="get" className="mt-1 block text-2xl font-semibold" />
          </div>
          <div className="text-right text-xs text-muted">
            {ct.owing} customers owe you
            <br />
            Advances held: <Money value={ct.advance} />
          </div>
        </Card>
        {st ? (
          <Card className="flex items-center justify-between p-4">
            <div>
              <div className="text-xs font-medium text-muted">You&apos;ll give · to suppliers</div>
              <Money value={st.payable} tone="give" className="mt-1 block text-2xl font-semibold" />
            </div>
            <div className="text-right text-xs text-muted">
              Advances paid: <Money value={st.advance} />
            </div>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchBox placeholder="Search party, description or T-number" className="sm:max-w-xs sm:flex-1" />
            <RangeFilter defaultRange="30d" />
            {showSup ? <SelectFilter param="party" options={[{ value: "", label: "Customers & suppliers" }, { value: "CUSTOMER", label: "Customers" }, { value: "SUPPLIER", label: "Suppliers" }]} /> : null}
          </div>
          {feed.length === 0 ? (
            <EmptyState icon={BookOpenText} title="No entries in this period" description="Entries from sales, payments and the khata appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {feed.map((t) => {
                const isCust = t.partyType === "CUSTOMER";
                const red = isCust ? t.effectP > 0 : t.effectP < 0;
                return (
                  <li key={t.id}>
                    <Link href={`/${isCust ? "customers" : "suppliers"}/${t.partyId}?txn=${t.txnNo}#${t.txnNo}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
                      <Avatar name={t.partyName} className="size-9" tone={red ? "get" : "give"} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{t.partyName}</span>
                          {!isCust ? <Badge>Supplier</Badge> : null}
                          {t.status === "REVERSED" ? <Badge tone="warn">Reversed</Badge> : t.status === "REVERSAL" ? <Badge tone="info">Correction</Badge> : null}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {TYPE[t.type]} · {t.description}
                          {t.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[t.paymentMethod as PaymentMethod]}` : ""}
                        </span>
                        <span className="block text-[11px] text-subtle" title={formatDateTime(t.createdAt)}>
                          {formatDate(t.txnDate)} · {t.txnNo} · {t.createdByName}
                        </span>
                      </span>
                      <span className="text-right">
                        <Money value={t.amountP} tone={red ? "get" : "give"} className={`font-semibold ${t.status === "REVERSED" ? "line-through opacity-60" : ""}`} />
                        <span className="block text-[11px] text-subtle">{red ? (isCust ? "You gave" : "You got") : isCust ? "You got" : "You gave"}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Highest balances" description="Customers who owe you the most" action={<Link href="/customers?status=owes&sort=balance" className="text-xs font-medium text-brand">All</Link>} />
          {owing.rows.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {owing.rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                    <Avatar name={c.name} className="size-8" tone="get" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                    <Money value={c.balance} tone="get" className="text-sm font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Nobody owes you money right now.</p>
          )}
        </Card>
      </div>
    </>
  );
}
