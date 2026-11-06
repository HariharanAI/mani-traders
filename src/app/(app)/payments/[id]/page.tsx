import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { AppError } from "@/server/core";
import { getPayment } from "@/server/services/payments";
import { PageHeader } from "@/components/page";
import { Badge, Card, Money } from "@/components/ui";
import { PaymentDetailActions } from "../client";
import { formatDate, formatDateTime } from "@/lib/dates";
import { amountInWords, toPaise } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/accounts";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePage();
  const { id } = await params;
  const db = await getDb();
  let p;
  try {
    p = await getPayment(db, actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const isIn = p.direction === "IN";
  const bal = p.balanceAfter !== null ? toPaise(p.balanceAfter) : null;
  const partyHref = p.partyType && p.partyId ? `/${p.partyType === "CUSTOMER" ? "customers" : "suppliers"}/${p.partyId}` : null;
  return (
    <>
      <PageHeader
        back={{ href: "/payments", label: "Payments" }}
        title={
          <span className="flex items-center gap-2">
            {isIn ? "Receipt" : "Payment voucher"} {p.paymentNo}
            {p.status !== "ACTIVE" ? <Badge tone="warn">Reversed</Badge> : null}
          </span>
        }
        description={`${formatDate(p.paymentDate)} · recorded by ${p.createdByName ?? "—"} on ${formatDateTime(p.createdAt)}`}
        actions={<PaymentDetailActions id={p.id} paymentNo={p.paymentNo} active={p.status === "ACTIVE"} reversible={!!p.ledgerTransactionId} hasParty={!!p.partyId} />}
      />
      <Card className="mx-auto max-w-2xl overflow-hidden">
        <div className={`p-6 ${isIn ? "bg-give-soft" : "bg-get-soft"}`}>
          <div className="text-sm text-muted">{isIn ? "Received from" : "Paid to"}</div>
          {partyHref ? (
            <Link href={partyHref} className="text-lg font-semibold hover:underline">
              {p.party?.name}
            </Link>
          ) : (
            <div className="text-lg font-semibold">Walk-in customer</div>
          )}
          <Money value={p.amountP} tone={isIn ? "give" : "get"} className={`mt-3 block text-4xl font-semibold tracking-tight ${p.status !== "ACTIVE" ? "line-through opacity-60" : ""}`} />
          <div className="mt-1 text-sm text-muted">{amountInWords(p.amountP)}</div>
        </div>
        <dl className="divide-y divide-border text-sm">
          {[
            ["Method", PAYMENT_METHOD_LABEL[p.method]],
            ["Reference", p.referenceNo ?? "—"],
            ["Against", p.sale ? <Link key="s" href={`/sales/${p.sale.id}`} className="text-brand hover:underline">Invoice {p.sale.invoiceNo}</Link> : p.purchase ? <Link key="p" href={`/purchases/${p.purchase.id}`} className="text-brand hover:underline">Purchase {p.purchase.purchaseNo}</Link> : "General payment"],
            ["Notes", p.notes ?? "—"],
            ...(bal !== null && p.partyType
              ? [[p.partyType === "CUSTOMER" ? (bal >= 0 ? "Outstanding after this payment" : "Advance after this payment") : bal >= 0 ? "Payable after this payment" : "Advance after this payment", <Money key="b" value={bal} abs tone={p.partyType === "CUSTOMER" ? "auto" : "invert"} className="font-semibold" />]]
              : []),
          ].map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-4 px-6 py-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
