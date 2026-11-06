import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError, getSettingsRow } from "@/server/core";
import { getSale } from "@/server/services/sales";
import { PageHeader } from "@/components/page";
import { Badge, Card, CardHeader, Money, Table } from "@/components/ui";
import { SaleActions } from "./client";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatINR, formatQty, toMilli, toPaise } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/accounts";
import { stateName } from "@/lib/gst";

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePage("sales.view");
  const { id } = await params;
  const { created } = await searchParams;
  const db = await getDb();
  let sale;
  try {
    sale = await getSale(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const settings = await getSettingsRow(db);
  const isTax = sale.taxMode !== "NONE";
  const status = sale.status !== "ACTIVE" ? "CANCELLED" : sale.due <= 0 ? "PAID" : sale.paid > 0 ? "PARTIAL" : "UNPAID";
  return (
    <>
      <PageHeader
        back={{ href: "/sales", label: "Sales" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {sale.invoiceNo}
            <Badge tone={status === "PAID" ? "give" : status === "PARTIAL" ? "warn" : status === "UNPAID" ? "get" : "neutral"}>{status.toLowerCase()}</Badge>
          </span>
        }
        description={`${isTax ? "Tax invoice" : "Bill of supply"} · ${formatDate(sale.saleDate)} · by ${sale.by ?? "—"}`}
        actions={
          <SaleActions
            sale={{ id: sale.id, invoiceNo: sale.invoiceNo, status: sale.status, customerId: sale.customerId, customerName: sale.customerName, customerMobile: sale.customer?.mobile ?? sale.customerMobile, due: sale.due, balance: 0, hasReturns: sale.returns.length > 0, paidCount: sale.payments.filter((p) => p.status === "ACTIVE" && p.direction === "IN").length }}
            items={sale.items.map((i) => ({ id: i.id, description: i.description, unit: i.unit, sold: toMilli(i.quantity), returned: toMilli(i.returnedQty), total: toPaise(i.total) }))}
          />
        }
      />
      {created ? (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-give/30 bg-give-soft px-4 py-3 text-sm text-give">
          <CheckCircle2 className="size-5" /> Invoice saved. Stock{sale.customerId ? " and the customer's khata were" : " was"} updated.
        </div>
      ) : null}
      {sale.status === "CANCELLED" ? (
        <div className="mb-4 rounded-xl border border-get/30 bg-get-soft px-4 py-3 text-sm text-get">
          Cancelled on {formatDateTime(sale.cancelledAt)} — {sale.cancelReason}. Reversal entries were posted; the original record is kept.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="grid gap-4 border-b border-border p-4 sm:grid-cols-2 sm:p-5">
            <div>
              <div className="text-xs font-medium text-muted">Bill to</div>
              {sale.customerId ? (
                <Link href={`/customers/${sale.customerId}`} className="font-semibold hover:underline">
                  {sale.customerName}
                </Link>
              ) : (
                <div className="font-semibold">{sale.customerName}</div>
              )}
              <div className="text-sm text-muted">
                {[sale.customerAddress, sale.customerMobile, sale.customerGstin ? `GSTIN ${sale.customerGstin}` : null].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            {isTax ? (
              <div className="sm:text-right">
                <div className="text-xs font-medium text-muted">Place of supply</div>
                <div className="text-sm">
                  {stateName(sale.placeOfSupply) ?? "—"} · {sale.isInterstate ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)"}
                </div>
              </div>
            ) : null}
          </div>
          <Table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="!text-right">Qty</th>
                <th className="!text-right">Rate</th>
                {isTax ? <th className="hidden !text-right sm:table-cell">GST</th> : null}
                <th className="!text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="font-medium">{i.description}</div>
                    <div className="text-xs text-muted">
                      {i.hsnCode ? `HSN ${i.hsnCode}` : ""}
                      {toPaise(i.discount) ? ` · Discount ${formatINR(toPaise(i.discount))}` : ""}
                      {toMilli(i.returnedQty) ? <span className="text-warn"> · Returned {formatQty(toMilli(i.returnedQty))}</span> : null}
                    </div>
                  </td>
                  <td className="tnum text-right">
                    {formatQty(toMilli(i.quantity))} {i.unit}
                  </td>
                  <td className="text-right">
                    <Money value={toPaise(i.rate)} />
                  </td>
                  {isTax ? <td className="hidden text-right text-muted sm:table-cell">{Number(i.gstRate)}%</td> : null}
                  <td className="text-right font-medium">
                    <Money value={toPaise(i.total)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="ml-auto max-w-sm space-y-1.5 border-t border-border p-4 text-sm sm:p-5">
            <R k="Subtotal" v={toPaise(sale.subtotal)} />
            {toPaise(sale.discountTotal) ? <R k="Discount" v={-toPaise(sale.discountTotal)} /> : null}
            {isTax ? (
              <>
                <R k="Taxable value" v={toPaise(sale.taxableTotal)} />
                {sale.isInterstate ? <R k="IGST" v={toPaise(sale.igstTotal)} /> : (
                  <>
                    <R k="CGST" v={toPaise(sale.cgstTotal)} />
                    <R k="SGST" v={toPaise(sale.sgstTotal)} />
                  </>
                )}
              </>
            ) : null}
            {toPaise(sale.roundOff) ? <R k="Round off" v={toPaise(sale.roundOff)} /> : null}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Grand total</dt>
              <dd className="tnum">{formatINR(sale.grand)}</dd>
            </div>
            {sale.returned ? <R k="Returns (credit notes)" v={-sale.returned} /> : null}
            <R k="Paid" v={sale.paid} />
            <div className="flex justify-between font-semibold text-get">
              <dt>Balance due</dt>
              <dd className="tnum">{formatINR(sale.due)}</dd>
            </div>
          </dl>
          {sale.notes ? <p className="border-t border-border px-5 py-3 text-sm text-muted">{sale.notes}</p> : null}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Payments" />
            {sale.payments.length ? (
              <ul className="divide-y divide-border px-1 py-2">
                {sale.payments.map((p) => (
                  <li key={p.id}>
                    <Link href={`/payments/${p.id}`} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-2">
                      <span>
                        <span className="block text-sm font-medium">{p.paymentNo}</span>
                        <span className="text-xs text-muted">
                          {formatDate(p.paymentDate)} · {PAYMENT_METHOD_LABEL[p.method]} {p.direction === "OUT" ? "· refund" : ""}
                        </span>
                      </span>
                      <span className="text-right">
                        <Money value={toPaise(p.amount)} tone={p.direction === "IN" ? "give" : "get"} className={p.status !== "ACTIVE" ? "line-through opacity-50" : "font-medium"} />
                        {p.status !== "ACTIVE" ? <div><Badge tone="warn">Reversed</Badge></div> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-sm text-muted">No payment recorded — full amount on credit.</p>
            )}
          </Card>
          {sale.returns.length ? (
            <Card>
              <CardHeader title="Returns / credit notes" />
              <ul className="divide-y divide-border px-4 py-2 text-sm">
                {sale.returns.map((r) => (
                  <li key={r.id} className="py-2">
                    <div className="flex justify-between font-medium">
                      <span>{r.returnNo}</span>
                      <Money value={toPaise(r.grandTotal)} />
                    </div>
                    <div className="text-xs text-muted">
                      {formatDate(r.returnDate)} · {r.reason}
                      {toPaise(r.refundAmount) ? ` · refunded ${formatINR(toPaise(r.refundAmount))}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="p-4 text-xs text-muted">
            Created {formatDateTime(sale.createdAt)} by {sale.by}. {settings.gstRegistered ? `Seller GSTIN ${settings.gstin}.` : "Business not GST registered."}
          </Card>
        </div>
      </div>
    </>
  );
}

function R({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="tnum">{formatINR(v)}</dd>
    </div>
  );
}
