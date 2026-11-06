import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError, can } from "@/server/core";
import { getSupplier, partySummary } from "@/server/services/parties";
import { partyStatement } from "@/server/services/khata";
import { listPurchases } from "@/server/services/purchases";
import { PageHeader } from "@/components/page";
import { RangeFilter } from "@/components/filters";
import { Avatar, Badge, Card, CardHeader, Money } from "@/components/ui";
import { LedgerTable, type LedgerRow } from "@/components/ledger";
import { SupplierActions } from "../client";
import { displayPhone } from "@/lib/utils";
import { formatDate, resolveRange } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("suppliers.view");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  let supplier;
  try {
    supplier = await getSupplier(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const party = { type: "SUPPLIER" as const, id };
  const range = sp.range ? resolveRange(sp) : null;
  const [summary, statement, purchases] = await Promise.all([
    partySummary(db, party),
    can(actor, "ledger.view") ? partyStatement(db, actor, party, range ?? {}) : null,
    can(actor, "purchases.view") ? listPurchases(db, actor, { supplierId: id, limit: 8 }) : null,
  ]);
  const bal = summary.balance;
  const rows: LedgerRow[] = (statement?.rows ?? []).map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  return (
    <>
      <PageHeader
        back={{ href: "/suppliers", label: "Suppliers" }}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={supplier.name} className="size-10" />
            {supplier.name}
            {supplier.archivedAt ? <Badge tone="warn">Archived</Badge> : null}
          </span>
        }
        description={
          <span className="flex flex-wrap gap-x-3">
            <span>{supplier.code}</span>
            {supplier.contactPerson ? <span>{supplier.contactPerson}</span> : null}
            {supplier.mobile ? (
              <a href={`tel:${supplier.mobile}`} className="inline-flex items-center gap-1">
                <Phone className="size-3.5" /> {displayPhone(supplier.mobile)}
              </a>
            ) : null}
            {supplier.gstin ? <span>GSTIN {supplier.gstin}</span> : null}
          </span>
        }
        actions={<SupplierActions supplier={supplier} balance={bal} />}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted">{bal > 0 ? "You'll give" : bal < 0 ? "You'll get" : "Balance"}</div>
              <Money value={bal} tone="invert" abs className="mt-1 block text-lg font-semibold sm:text-2xl" />
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Purchases</div>
              <Money value={summary.given} className="mt-1 block text-lg font-semibold sm:text-2xl" />
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Paid</div>
              <Money value={summary.received} className="mt-1 block text-lg font-semibold sm:text-2xl" />
            </Card>
          </div>
          {statement ? (
            <Card>
              <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="px-1 text-[15px] font-semibold">Supplier ledger</h2>
                <RangeFilter defaultRange="" presets={["30d", "month", "prev_month", "fy", "custom"]} />
              </div>
              <LedgerTable rows={rows} partyType="SUPPLIER" opening={statement.opening} partyPath={`/suppliers/${id}`} />
              <div className="flex justify-between border-t border-border px-4 py-3 text-sm">
                <span className="font-medium">Closing balance</span>
                <Money value={statement.closing} tone="invert" abs className="font-semibold" />
              </div>
            </Card>
          ) : null}
        </div>
        <aside className="space-y-4">
          {purchases ? (
            <Card>
              <CardHeader title="Purchases" />
              {purchases.rows.length ? (
                <ul className="divide-y divide-border px-1 py-2">
                  {purchases.rows.map((p) => (
                    <li key={p.id}>
                      <Link href={`/purchases/${p.id}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-surface-2">
                        <span>
                          <span className="block text-sm font-medium">{p.purchaseNo}</span>
                          <span className="text-xs text-muted">
                            {formatDate(p.purchaseDate)}
                            {p.supplierInvoiceNo ? ` · Bill ${p.supplierInvoiceNo}` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="tnum block text-sm font-medium">{formatINR(p.grand)}</span>
                          {p.status === "CANCELLED" ? <Badge>Cancelled</Badge> : p.due > 0 ? <Badge tone="warn">Due {formatINR(p.due, { decimals: false })}</Badge> : <Badge tone="give">Paid</Badge>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-6 text-sm text-muted">No purchases yet.</p>
              )}
            </Card>
          ) : null}
          {supplier.address || supplier.notes ? (
            <Card className="space-y-2 p-4 text-sm">
              {supplier.address ? <div><div className="text-xs text-muted">Address</div>{supplier.address}</div> : null}
              {supplier.notes ? <div><div className="text-xs text-muted">Notes</div>{supplier.notes}</div> : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
