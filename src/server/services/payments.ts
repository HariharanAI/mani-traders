/**
 * Payments in/out. Each payment is one journal entry + one khata row + one
 * payments row (+ a receipt for money received). Idempotent per submission key.
 */
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB, Executor, Tx } from "../db/client";
import * as s from "../db/schema";
import {
  AppError,
  assertCan,
  audit,
  getSettingsRow,
  insertLedgerTxn,
  nextDocNumber,
  notFound,
  partyBalance,
  postJournal,
  reverseLedgerTxnRow,
  type Actor,
  type Party,
} from "../core";
import { ACC, moneyAccountFor, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { paymentSchema, type PaymentInput } from "@/lib/validators";
import { formatINR, fromPaise, toPaise, type Paise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { assertPartyAccess, customerScope } from "./parties";
import { notify } from "./notifications";

export type PaymentRow = typeof s.payments.$inferSelect;

/** Creates a payment inside an existing transaction. */
export async function recordPaymentTx(
  tx: Tx,
  actor: Actor,
  v: {
    direction: "IN" | "OUT";
    party: Party;
    amount: Paise;
    method: PaymentMethod;
    date: string;
    referenceNo?: string | null;
    notes?: string | null;
    saleId?: string | null;
    purchaseId?: string | null;
    idempotencyKey?: string | null;
    description?: string;
  },
): Promise<PaymentRow> {
  if (v.amount <= 0) throw new AppError("Amount must be greater than zero");
  assertCan(actor, v.direction === "IN" ? "payments.receive" : "payments.make");
  const partyRow = await assertPartyAccess(tx, actor, v.party);
  if (v.saleId) {
    const [sale] = await tx.select().from(s.sales).where(eq(s.sales.id, v.saleId));
    if (!sale || sale.customerId !== v.party.id || v.party.type !== "CUSTOMER") throw new AppError("Invoice does not belong to this customer.");
    if (sale.status !== "ACTIVE") throw new AppError("Cannot record a payment against a cancelled invoice.");
  }
  if (v.purchaseId) {
    const [p] = await tx.select().from(s.purchases).where(eq(s.purchases.id, v.purchaseId));
    if (!p || p.supplierId !== v.party.id || v.party.type !== "SUPPLIER") throw new AppError("Purchase does not belong to this supplier.");
    if (p.status !== "ACTIVE") throw new AppError("Cannot record a payment against a cancelled purchase.");
  }

  const id = crypto.randomUUID();
  const money = moneyAccountFor(v.method);
  const control = v.party.type === "CUSTOMER" ? ACC.RECEIVABLE : ACC.PAYABLE;
  // IN: money comes in (Dr money, Cr party). OUT: money goes out (Dr party, Cr money).
  const lines =
    v.direction === "IN"
      ? [{ account: money, debit: v.amount }, { account: control, party: v.party, credit: v.amount }]
      : [{ account: control, party: v.party, debit: v.amount }, { account: money, credit: v.amount }];
  // Effect on the party's running balance (customer: receivable; supplier: payable)
  const balanceEffect =
    v.party.type === "CUSTOMER" ? (v.direction === "IN" ? -v.amount : v.amount) : v.direction === "OUT" ? -v.amount : v.amount;

  const paymentNo = await nextDocNumber(tx, v.direction === "IN" ? "receipt" : "voucher", v.date);
  const label = v.direction === "IN" ? `Payment received` : `Payment made`;
  const je = await postJournal(tx, actor, {
    date: v.date,
    memo: `${label} ${paymentNo} — ${partyRow.name} (${PAYMENT_METHOD_LABEL[v.method]})`,
    sourceType: "PAYMENT",
    sourceId: id,
    lines,
  });
  const lt = await insertLedgerTxn(tx, actor, {
    party: v.party,
    date: v.date,
    type: v.direction === "IN" ? "PAYMENT_IN" : "PAYMENT_OUT",
    description: v.description ?? `${label} (${PAYMENT_METHOD_LABEL[v.method]})`,
    amount: v.amount,
    balanceEffect,
    journalEntryId: je.id,
    paymentMethod: v.method,
    referenceNo: v.referenceNo ?? null,
    notes: v.notes ?? null,
    sourceType: "PAYMENT",
    sourceId: id,
    idempotencyKey: v.idempotencyKey ? `lt:${v.idempotencyKey}` : null,
  });
  const balanceAfter = await partyBalance(tx, v.party);
  const [payment] = await tx
    .insert(s.payments)
    .values({
      id,
      paymentNo,
      direction: v.direction,
      partyType: v.party.type,
      partyId: v.party.id,
      paymentDate: v.date,
      amount: fromPaise(v.amount),
      method: v.method,
      referenceNo: v.referenceNo ?? null,
      notes: v.notes ?? null,
      saleId: v.saleId ?? null,
      purchaseId: v.purchaseId ?? null,
      balanceAfter: fromPaise(balanceAfter),
      ledgerTransactionId: lt.id,
      journalEntryId: je.id,
      idempotencyKey: v.idempotencyKey ?? null,
      createdBy: actor.id,
    })
    .returning();
  if (v.direction === "IN") await tx.insert(s.receipts).values({ receiptNo: paymentNo, paymentId: id });

  await audit(tx, actor, "CREATE", "payment", id, `${label} ${paymentNo}: ${formatINR(v.amount)} ${v.direction === "IN" ? "from" : "to"} ${partyRow.name}`, { after: payment });
  if (v.direction === "IN" && v.party.type === "CUSTOMER") {
    await notify(tx, {
      type: "PAYMENT_RECEIVED",
      title: `${formatINR(v.amount)} received from ${partyRow.name}`,
      body: `${PAYMENT_METHOD_LABEL[v.method]}${v.referenceNo ? ` · Ref ${v.referenceNo}` : ""} · Balance now ${formatINR(balanceAfter)}`,
      link: `/customers/${v.party.id}`,
      severity: "success",
      audience: "MANAGERS",
    });
  }
  const settings = await getSettingsRow(tx);
  if (v.amount >= toPaise(settings.unusualTxnThreshold)) {
    await notify(tx, {
      type: "UNUSUAL",
      title: `Large payment: ${formatINR(v.amount)} ${v.direction === "IN" ? "from" : "to"} ${partyRow.name}`,
      body: `Recorded by ${actor.name} · ${paymentNo}`,
      link: `/payments/${id}`,
      severity: "warning",
    });
  }
  return payment;
}

/** Public API: validated + idempotent. Returns the existing payment if the same submission arrives twice. */
export async function recordPayment(db: DB, actor: Actor, raw: PaymentInput) {
  const input = paymentSchema.parse(raw);
  const [existing] = await db.select().from(s.payments).where(eq(s.payments.idempotencyKey, input.idempotencyKey));
  if (existing) return { payment: existing, duplicate: true };
  const payment = await db.transaction((tx) =>
    recordPaymentTx(tx, actor, {
      direction: input.direction,
      party: { type: input.partyType, id: input.partyId },
      amount: toPaise(input.amount),
      method: input.method,
      date: input.date,
      referenceNo: input.referenceNo,
      notes: input.notes,
      saleId: input.saleId,
      purchaseId: input.purchaseId,
      idempotencyKey: input.idempotencyKey,
    }),
  );
  return { payment, duplicate: false };
}

export async function reversePaymentTx(tx: Tx, actor: Actor, paymentId: string, reason: string) {
  assertCan(actor, "payments.reverse");
  const [p] = await tx.select().from(s.payments).where(eq(s.payments.id, paymentId)).for("update");
  if (!p) throw notFound("Payment");
  if (p.status !== "ACTIVE") throw new AppError("This payment has already been reversed.", undefined, "CONFLICT");
  if (!p.ledgerTransactionId) throw new AppError("Walk-in sale payments are reversed by cancelling the invoice.");
  await reverseLedgerTxnRow(tx, actor, p.ledgerTransactionId, reason, todayIST());
  await tx.update(s.payments).set({ status: "REVERSED" }).where(eq(s.payments.id, paymentId));
  await audit(tx, actor, "REVERSE", "payment", paymentId, `Payment ${p.paymentNo} (${formatINR(toPaise(p.amount))}) reversed: ${reason}`, { before: p });
  await notify(tx, { type: "REVERSAL", title: `Payment ${p.paymentNo} reversed`, body: `${formatINR(toPaise(p.amount))} · ${reason} · by ${actor.name}`, link: `/payments/${p.id}`, severity: "warning" });
}

export async function reversePayment(db: DB, actor: Actor, paymentId: string, reason: string) {
  return db.transaction((tx) => reversePaymentTx(tx, actor, paymentId, reason));
}

// ---------------------------------------------------------------- queries
export async function listPayments(
  db: Executor,
  actor: Actor,
  f: { direction?: "IN" | "OUT"; method?: PaymentMethod; from?: string; to?: string; q?: string; partyType?: "CUSTOMER" | "SUPPLIER"; partyId?: string; limit?: number; offset?: number } = {},
) {
  const partyName = sql<string>`coalesce(${s.customers.name}, ${s.suppliers.name}, 'Walk-in customer')`;
  const scope = customerScope(actor);
  const where = and(
    f.direction ? eq(s.payments.direction, f.direction) : undefined,
    f.method ? eq(s.payments.method, f.method) : undefined,
    f.from ? sql`${s.payments.paymentDate} >= ${f.from}` : undefined,
    f.to ? sql`${s.payments.paymentDate} <= ${f.to}` : undefined,
    f.partyType ? eq(s.payments.partyType, f.partyType) : undefined,
    f.partyId ? eq(s.payments.partyId, f.partyId) : undefined,
    f.q ? or(ilike(s.payments.paymentNo, `%${f.q}%`), ilike(s.payments.referenceNo, `%${f.q}%`), ilike(partyName, `%${f.q}%`)) : undefined,
    // employees with restricted scope only see their customers' payments
    scope ? sql`(${s.payments.partyType} = 'CUSTOMER' and ${s.customers.assignedTo} = ${actor.id})` : undefined,
  );
  const rows = await db
    .select({ p: s.payments, partyName, createdByName: s.users.name })
    .from(s.payments)
    .leftJoin(s.customers, and(eq(s.payments.partyType, "CUSTOMER"), eq(s.customers.id, s.payments.partyId)))
    .leftJoin(s.suppliers, and(eq(s.payments.partyType, "SUPPLIER"), eq(s.suppliers.id, s.payments.partyId)))
    .leftJoin(s.users, eq(s.users.id, s.payments.createdBy))
    .where(where)
    .orderBy(desc(s.payments.paymentDate), desc(s.payments.createdAt))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      inSum: sql<string>`coalesce(sum(case when ${s.payments.direction} = 'IN' and ${s.payments.status} = 'ACTIVE' then ${s.payments.amount} end), 0)`,
      outSum: sql<string>`coalesce(sum(case when ${s.payments.direction} = 'OUT' and ${s.payments.status} = 'ACTIVE' then ${s.payments.amount} end), 0)`,
    })
    .from(s.payments)
    .leftJoin(s.customers, and(eq(s.payments.partyType, "CUSTOMER"), eq(s.customers.id, s.payments.partyId)))
    .leftJoin(s.suppliers, and(eq(s.payments.partyType, "SUPPLIER"), eq(s.suppliers.id, s.payments.partyId)))
    .where(where);
  return {
    total: agg.total,
    inSum: toPaise(agg.inSum),
    outSum: toPaise(agg.outSum),
    rows: rows.map((r) => ({ ...r.p, amountP: toPaise(r.p.amount), partyName: r.partyName, createdByName: r.createdByName })),
  };
}

export async function getPayment(db: Executor, actor: Actor, id: string) {
  const [row] = await db
    .select({ p: s.payments, createdByName: s.users.name })
    .from(s.payments)
    .leftJoin(s.users, eq(s.users.id, s.payments.createdBy))
    .where(eq(s.payments.id, id));
  if (!row) throw notFound("Payment");
  const party = await assertPartyAccess(db, actor, { type: row.p.partyType, id: row.p.partyId });
  let sale = null;
  if (row.p.saleId) [sale] = await db.select().from(s.sales).where(eq(s.sales.id, row.p.saleId));
  let purchase = null;
  if (row.p.purchaseId) [purchase] = await db.select().from(s.purchases).where(eq(s.purchases.id, row.p.purchaseId));
  return { ...row.p, amountP: toPaise(row.p.amount), createdByName: row.createdByName, party, sale, purchase };
}

/** Open invoices for a customer (to optionally link a payment). */
export async function openInvoices(db: Executor, customerId: string) {
  const rows = await db
    .select({
      id: s.sales.id,
      invoiceNo: s.sales.invoiceNo,
      saleDate: s.sales.saleDate,
      grandTotal: s.sales.grandTotal,
      paid: sql<string>`coalesce((select sum(p.amount) from payments p where p.sale_id = ${s.sales.id} and p.status = 'ACTIVE' and p.direction = 'IN'), 0)`,
      returned: sql<string>`coalesce((select sum(r.grand_total) from sale_returns r where r.sale_id = ${s.sales.id}), 0)`,
    })
    .from(s.sales)
    .where(and(eq(s.sales.customerId, customerId), eq(s.sales.status, "ACTIVE")))
    .orderBy(desc(s.sales.saleDate))
    .limit(50);
  return rows
    .map((r) => ({ ...r, due: toPaise(r.grandTotal) - toPaise(r.paid) - toPaise(r.returned) }))
    .filter((r) => r.due > 0);
}

export async function paymentsForIds(db: Executor, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(s.payments).where(inArray(s.payments.id, ids));
}
