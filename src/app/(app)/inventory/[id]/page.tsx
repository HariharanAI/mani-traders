import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError, can } from "@/server/core";
import { getProduct, productMovements } from "@/server/services/inventory";
import { PageHeader } from "@/components/page";
import { Badge, Card, CardHeader, EmptyState, Money, Table } from "@/components/ui";
import { ProductActions } from "../client";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatINR, formatQty, lineAmount, toMilli, toPaise } from "@/lib/money";

const MV: Record<string, string> = { OPENING: "Opening stock", PURCHASE: "Purchase", PURCHASE_CANCEL: "Purchase cancelled", PURCHASE_RETURN: "Purchase return", SALE: "Sale", SALE_CANCEL: "Sale cancelled", SALE_RETURN: "Sales return", STOCK_IN: "Stock in", STOCK_OUT: "Stock out", ADJUSTMENT: "Count adjustment" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePage("inventory.view");
  const { id } = await params;
  const db = await getDb();
  let p;
  try {
    p = await getProduct(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const moves = await productMovements(db, id);
  const qty = toMilli(p.stockQty);
  const min = toMilli(p.minStock);
  const showCost = can(actor, "inventory.manage") || can(actor, "reports.view");
  const srcHref = (t: string | null, sid: string | null) => (!sid ? null : t === "SALE" ? `/sales/${sid}` : t === "PURCHASE" ? `/purchases/${sid}` : null);
  return (
    <>
      <PageHeader
        back={{ href: "/inventory", label: "Inventory" }}
        title={
          <span className="flex items-center gap-2">
            {p.name}
            {p.archivedAt ? <Badge tone="warn">Archived</Badge> : null}
          </span>
        }
        description={[p.code, p.sku ? `SKU ${p.sku}` : null, p.barcode ? `Barcode ${p.barcode}` : null, p.hsnCode ? `HSN ${p.hsnCode}` : null, p.category].filter(Boolean).join(" · ")}
        actions={<ProductActions product={p} stock={formatQty(qty)} avgCost={p.avgCost} archived={!!p.archivedAt} />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">In stock</div>
          <div className={`tnum mt-1 text-2xl font-semibold ${qty <= 0 ? "text-get" : qty <= min && min > 0 ? "text-warn" : ""}`}>
            {formatQty(qty)} <span className="text-sm font-normal text-muted">{p.unit}</span>
          </div>
          <div className="text-xs text-subtle">Alert at {formatQty(min)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Selling price</div>
          <Money value={toPaise(p.sellingPrice)} className="mt-1 block text-2xl font-semibold" />
          <div className="text-xs text-subtle">GST {Number(p.gstRate)}%</div>
        </Card>
        {showCost ? (
          <>
            <Card className="p-4">
              <div className="text-xs text-muted">Average cost</div>
              <Money value={toPaise(p.avgCost)} className="mt-1 block text-2xl font-semibold" />
              <div className="text-xs text-subtle">Last purchase {formatINR(toPaise(p.purchasePrice))}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted">Stock value</div>
              <Money value={qty > 0 ? lineAmount(qty, toPaise(p.avgCost)) : 0} className="mt-1 block text-2xl font-semibold" />
            </Card>
          </>
        ) : null}
      </div>
      <Card>
        <CardHeader title="Stock movement history" description="Every change, with its source" />
        {moves.length ? (
          <Table className="mt-3">
            <thead>
              <tr>
                <th>Date</th>
                <th>Movement</th>
                <th className="!text-right">Change</th>
                <th className="!text-right">Balance</th>
                <th className="hidden md:table-cell">Reason / reference</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const q = toMilli(m.quantity);
                const href = srcHref(m.sourceType, m.sourceId);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">
                      {formatDate(m.movementDate)}
                      <div className="text-xs text-muted" title={formatDateTime(m.createdAt)}>
                        {m.by}
                      </div>
                    </td>
                    <td>{MV[m.type] ?? m.type}</td>
                    <td className={`tnum text-right font-medium ${q > 0 ? "text-give" : "text-get"}`}>
                      {q > 0 ? "+" : ""}
                      {formatQty(q)}
                    </td>
                    <td className="tnum text-right">{formatQty(toMilli(m.balanceAfter))}</td>
                    <td className="hidden text-muted md:table-cell">
                      {href ? (
                        <Link href={href} className="text-brand hover:underline">
                          {(m.reason ?? "").replace(/\s\[[^\]]+\]$/, "")}
                        </Link>
                      ) : (
                        (m.reason ?? "").replace(/\s\[[^\]]+\]$/, "")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No stock movements yet" description="Purchases, sales and adjustments will appear here." className="py-10" />
        )}
      </Card>
    </>
  );
}

