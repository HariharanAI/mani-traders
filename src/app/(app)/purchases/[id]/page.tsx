import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError, getSettingsRow } from "@/server/core";
import { getPurchase } from "@/server/services/purchases";
import { PageHeader } from "@/components/page";
import { Badge, Card, CardHeader, Money, Table } from "@/components/ui";
import { PurchaseActions } from "./client";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatINR, formatQty, toMilli, toPaise } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/accounts";

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePage("purchases.view");
  const { id } = await params;
  const db = await getDb();
  let p;
  try {
    p = await getPurchase(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const settings = await getSettingsRow(db);
  const itc = settings.gstRegistered && settings.gstScheme === "REGULAR";
  const tax = toPaise(p.cgstTotal) + toPaise(p.sgstTotal) + toPaise(p.igstTotal);
  return (
    <>
      <PageHeader
        back={{ href: "/purchases", label: "Purchases" }}
        title={
          <span className="flex items-center gap-2">
            {p.purchaseNo}
            {p.status === "CANCELLED" ? <Badge>Cancelled</Badge> : p.due > 0 ? <Badge tone="warn">Due</Badge> : <Badge tone="give">Paid</Badge>}
          </span>
        }
        description={`${formatDate(p.purchaseDate)}${p.supplierInvoiceNo ? ` · Supplier bill ${p.supplierInvoiceNo}` : ""} · by ${p.by ?? "—"}`}
        actions={<PurchaseActions purchase={{ id: p.id, purchaseNo: p.purchaseNo, status: p.status, supplierId: p.supplierId, supplierName: p.supplier.name, due: p.due, paidCount: p.payments.filter((x) => x.status === "ACTIVE").length }} />}
      />
      {p.status === "CANCELLED" ? <div className="mb-4 rounded-xl border border-get/30 bg-get-soft px-4 py-3 text-sm text-get">Cancelled on {formatDateTime(p.cancelledAt)} — {p.cancelReason}</div> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <div className="border-b border-border p-4 sm:p-5">
            <div className="text-xs text-muted">Supplier</div>
            <Link href={`/suppliers/${p.supplierId}`} className="font-semibold hover:underline">
              {p.supplier.name}
            </Link>
            <div className="text-sm text-muted">{[p.supplier.gstin ? `GSTIN ${p.supplier.gstin}` : null, p.supplier.mobile].filter(Boolean).join(" · ")}</div>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="!text-right">Qty</th>
                <th className="!text-right">Rate</th>
                <th className="hidden !text-right sm:table-cell">GST</th>
                <th className="!text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/inventory/${i.productId}`} className="font-medium hover:underline">
                      {i.description}
                    </Link>
                  </td>
                  <td className="tnum text-right">
                    {formatQty(toMilli(i.quantity))} {i.unit}
                  </td>
                  <td className="text-right">
                    <Money value={toPaise(i.rate)} />
                  </td>
                  <td className="hidden text-right text-muted sm:table-cell">{Number(i.gstRate)}%</td>
                  <td className="text-right font-medium">
                    <Money value={toPaise(i.total)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <dl className="ml-auto max-w-sm space-y-1.5 border-t border-border p-4 text-sm sm:p-5">
            <div className="flex justify-between"><dt className="text-muted">Taxable value</dt><dd className="tnum">{formatINR(toPaise(p.taxableTotal))}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">GST {itc ? "(input credit)" : "(added to cost)"}</dt><dd className="tnum">{formatINR(tax)}</dd></div>
            {toPaise(p.roundOff) ? <div className="flex justify-between"><dt className="text-muted">Round off</dt><dd className="tnum">{formatINR(toPaise(p.roundOff))}</dd></div> : null}
            <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tnum">{formatINR(p.grand)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd className="tnum">{formatINR(p.paid)}</dd></div>
            <div className="flex justify-between font-semibold text-give"><dt>Payable</dt><dd className="tnum">{formatINR(p.due)}</dd></div>
          </dl>
          {p.notes || p.attachmentKey ? (
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted">
              <span>{p.notes}</span>
              {p.attachmentKey ? (
                <a href={`/api/files/${p.attachmentKey}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand">
                  <Paperclip className="size-4" /> Supplier bill
                </a>
              ) : null}
            </div>
          ) : null}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Payments" />
          {p.payments.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {p.payments.map((x) => (
                <li key={x.id}>
                  <Link href={`/payments/${x.id}`} className="flex justify-between rounded-lg px-3 py-2 hover:bg-surface-2">
                    <span>
                      <span className="block text-sm font-medium">{x.paymentNo}</span>
                      <span className="text-xs text-muted">
                        {formatDate(x.paymentDate)} · {PAYMENT_METHOD_LABEL[x.method]}
                      </span>
                    </span>
                    <Money value={toPaise(x.amount)} className={x.status !== "ACTIVE" ? "line-through opacity-50" : "font-medium"} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-5 text-sm text-muted">Not paid yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
