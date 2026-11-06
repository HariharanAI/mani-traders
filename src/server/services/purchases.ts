/**
 * Purchases from suppliers. Stock comes in at landed cost (taxable value, plus
 * GST when input tax credit cannot be claimed). Supplier payable goes up by the
 * bill total; any amount paid is a separate payment voucher.
 */
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import {
  AppError,
  assertCan,
  audit,
  getSettingsRow,
  insertLedgerTxn,
  nextDocNumber,
  notFound,
  postJournal,
  reverseLedgerTxnRow,
  type Actor,
} from "../core";
import { ACC, PAYMENT_METHOD_LABEL } from "@/lib/accounts";
import { cancelSchema, purchaseSchema, type PurchaseInput } from "@/lib/validators";
import { computeBill } from "@/lib/gst";
import { divRound, formatINR, fromMilli, fromPaise, toMilli, toPaise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { applyMovement, allowNegativeFor } from "./inventory";
import { recordPaymentTx, reversePaymentTx } from "./payments";
import { getSupplier } from "./parties";
import { notify } from "./notifications";

export async function createPurchase(db: DB, actor: Actor, raw: PurchaseInput) {
  assertCan(actor, "purchases.create");
  const input = purchaseSchema.parse(raw);
  const [dup] = await db.select().from(s.purchases).where(eq(s.purchases.idempotencyKey, input.idempotencyKey));
  if (dup) return { purchase: dup, duplicate: true };

  const purchase = await db.transaction(async (tx) => {
    const settings = await getSettingsRow(tx);
    const supplier = await getSupplier(tx, actor, input.supplierId);
    if (supplier.archivedAt) throw new AppError("This supplier is archived. Restore them first.");
    const interstate = !!(input.taxMode !== "NONE" && supplier.stateCode && settings.stateCode && supplier.stateCode !== settings.stateCode);
    const itcEligible = settings.gstRegistered && settings.gstScheme === "REGULAR";

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await tx.select().from(s.products).where(inArray(s.products.id, productIds));
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) if (!productMap.get(id)) throw new AppError("One of the products was not found.");

    let bill;
    try {
      bill = computeBill(input.lines, input.taxMode, interstate, true);
    } catch (e) {
      throw new AppError((e as Error).message);
    }
    if (bill.grandTotal <= 0) throw new AppError("Purchase total must be greater than zero.");
    const paid = toPaise(input.amountPaid);
    if (paid > bill.grandTotal) throw new AppError("Amount paid cannot exceed the purchase total.", { amountPaid: "Too high" });

    const purchaseId = crypto.randomUUID();
    const purchaseNo = await nextDocNumber(tx, "purchase", input.date);
    const party = { type: "SUPPLIER" as const, id: supplier.id };
    const inventoryCost = bill.lines.reduce((a, l) => a + l.taxable + (itcEligible ? 0 : l.tax), 0);
    const je = await postJournal(tx, actor, {
      date: input.date,
      memo: `Purchase ${purchaseNo} — ${supplier.name}${input.supplierInvoiceNo ? ` (bill ${input.supplierInvoiceNo})` : ""}`,
      sourceType: "PURCHASE",
      sourceId: purchaseId,
      lines: [
        { account: ACC.INVENTORY, debit: inventoryCost },
        { account: ACC.GST_INPUT, debit: itcEligible ? bill.taxTotal : 0 },
        // grandTotal = taxable + tax + roundOff → positive roundOff costs us (debit)
        { account: ACC.ROUND_OFF, debit: bill.roundOff > 0 ? bill.roundOff : 0, credit: bill.roundOff < 0 ? -bill.roundOff : 0 },
        { account: ACC.PAYABLE, party, credit: bill.grandTotal },
      ],
    });
    const [row] = await tx
      .insert(s.purchases)
      .values({
        id: purchaseId,
        purchaseNo,
        supplierId: supplier.id,
        supplierInvoiceNo: input.supplierInvoiceNo,
        purchaseDate: input.date,
        isInterstate: interstate,
        taxMode: input.taxMode,
        subtotal: fromPaise(bill.subtotal),
        discountTotal: fromPaise(bill.discountTotal),
        taxableTotal: fromPaise(bill.taxableTotal),
        cgstTotal: fromPaise(bill.cgstTotal),
        sgstTotal: fromPaise(bill.sgstTotal),
        igstTotal: fromPaise(bill.igstTotal),
        roundOff: fromPaise(bill.roundOff),
        grandTotal: fromPaise(bill.grandTotal),
        notes: input.notes,
        attachmentKey: input.attachmentKey,
        journalEntryId: je.id,
        idempotencyKey: input.idempotencyKey,
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(s.purchaseItems).values(
      input.lines.map((l, i) => {
        const r = bill.lines[i];
        const p = productMap.get(l.productId)!;
        return {
          purchaseId,
          lineNo: i + 1,
          productId: l.productId,
          description: l.description,
          unit: l.unit || p.unit,
          quantity: fromMilli(r.qtyMilli),
          rate: fromPaise(r.rate),
          discount: fromPaise(r.discount),
          taxable: fromPaise(r.taxable),
          gstRate: fromPaise(r.gstRate),
          cgst: fromPaise(r.cgst),
          sgst: fromPaise(r.sgst),
          igst: fromPaise(r.igst),
          total: fromPaise(r.total),
        };
      }),
    );
    for (const [i, l] of input.lines.entries()) {
      const r = bill.lines[i];
      const landed = r.taxable + (itcEligible ? 0 : r.tax);
      const unitCost = divRound(BigInt(landed) * 1000n, BigInt(r.qtyMilli));
      await applyMovement(tx, actor, { productId: l.productId, qtyMilli: r.qtyMilli, type: "PURCHASE", date: input.date, unitCost, sourceType: "PURCHASE", sourceId: purchaseId, reason: `Purchase ${purchaseNo}`, journalEntryId: je.id });
      // remember the latest pre-tax purchase rate per unit
      await tx.update(s.products).set({ purchasePrice: fromPaise(divRound(BigInt(r.taxable) * 1000n, BigInt(r.qtyMilli))) }).where(eq(s.products.id, l.productId));
    }
    await insertLedgerTxn(tx, actor, {
      party,
      date: input.date,
      type: "PURCHASE",
      description: `Purchase ${purchaseNo}${input.supplierInvoiceNo ? ` — bill ${input.supplierInvoiceNo}` : ""}`,
      amount: bill.grandTotal,
      balanceEffect: bill.grandTotal,
      journalEntryId: je.id,
      referenceNo: input.supplierInvoiceNo ?? purchaseNo,
      sourceType: "PURCHASE",
      sourceId: purchaseId,
    });
    if (paid > 0) {
      await recordPaymentTx(tx, actor, {
        direction: "OUT",
        party,
        amount: paid,
        method: input.paymentMethod,
        date: input.date,
        referenceNo: input.paymentReference,
        purchaseId,
        description: `Payment for purchase ${purchaseNo} (${PAYMENT_METHOD_LABEL[input.paymentMethod]})`,
      });
    }
    await audit(tx, actor, "CREATE", "purchase", purchaseId, `Purchase ${purchaseNo}: ${formatINR(bill.grandTotal)} — ${supplier.name}`, { after: row });
    await notify(tx, { type: "PURCHASE", title: `New purchase ${purchaseNo}: ${formatINR(bill.grandTotal)}`, body: `${supplier.name} · ${paid >= bill.grandTotal ? "Paid" : paid > 0 ? `Paid ${formatINR(paid)}` : "On credit"} · by ${actor.name}`, link: `/purchases/${purchaseId}` });
    if (bill.grandTotal >= toPaise(settings.unusualTxnThreshold)) {
      await notify(tx, { type: "UNUSUAL", title: `Large purchase: ${formatINR(bill.grandTotal)}`, body: `${purchaseNo} · ${supplier.name}`, link: `/purchases/${purchaseId}`, severity: "warning" });
    }
    return row;
  });
  return { purchase, duplicate: false };
}

export async function cancelPurchase(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "purchases.cancel");
  const input = cancelSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(s.purchases).where(eq(s.purchases.id, input.id)).for("update");
    if (!p) throw notFound("Purchase");
    if (p.status !== "ACTIVE") throw new AppError("This purchase is already cancelled.", undefined, "CONFLICT");
    const today = todayIST();
    const reason = `Purchase ${p.purchaseNo} cancelled: ${input.reason}`;
    const [lt] = await tx.select().from(s.ledgerTransactions).where(and(eq(s.ledgerTransactions.sourceType, "PURCHASE"), eq(s.ledgerTransactions.sourceId, p.id), eq(s.ledgerTransactions.status, "ACTIVE")));
    if (!lt) throw new Error("Purchase ledger entry missing");
    await reverseLedgerTxnRow(tx, actor, lt.id, reason, today);
    const items = await tx.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseId, p.id));
    const allowNeg = await allowNegativeFor(tx, actor, false);
    for (const it of items) {
      await applyMovement(tx, actor, { productId: it.productId, qtyMilli: -toMilli(it.quantity), type: "PURCHASE_CANCEL", date: today, sourceType: "PURCHASE", sourceId: p.id, reason, allowNegative: allowNeg });
    }
    if (input.reversePayments) {
      const pays = await tx.select().from(s.payments).where(and(eq(s.payments.purchaseId, p.id), eq(s.payments.status, "ACTIVE")));
      for (const pay of pays) await reversePaymentTx(tx, actor, pay.id, `${reason} (payment returned)`);
    }
    await tx.update(s.purchases).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: input.reason }).where(eq(s.purchases.id, p.id));
    await audit(tx, actor, "CANCEL", "purchase", p.id, reason, { before: p });
    await notify(tx, { type: "REVERSAL", title: `Purchase ${p.purchaseNo} cancelled`, body: `${formatINR(toPaise(p.grandTotal))} · ${input.reason}`, link: `/purchases/${p.id}`, severity: "warning" });
  });
}

const paidExpr = sql<string>`coalesce((select sum(p.amount) from payments p where p.purchase_id = ${s.purchases.id} and p.status = 'ACTIVE' and p.direction = 'OUT'), 0)`;

export async function listPurchases(db: Executor, actor: Actor, f: { q?: string; from?: string; to?: string; supplierId?: string; status?: string; limit?: number; offset?: number } = {}) {
  assertCan(actor, "purchases.view");
  const where = and(
    f.from ? sql`${s.purchases.purchaseDate} >= ${f.from}` : undefined,
    f.to ? sql`${s.purchases.purchaseDate} <= ${f.to}` : undefined,
    f.supplierId ? eq(s.purchases.supplierId, f.supplierId) : undefined,
    f.status === "cancelled" ? eq(s.purchases.status, "CANCELLED") : f.status === "active" ? eq(s.purchases.status, "ACTIVE") : undefined,
    f.q ? or(ilike(s.purchases.purchaseNo, `%${f.q}%`), ilike(s.purchases.supplierInvoiceNo, `%${f.q}%`), ilike(s.suppliers.name, `%${f.q}%`)) : undefined,
  );
  const rows = await db
    .select({ p: s.purchases, supplierName: s.suppliers.name, paid: paidExpr })
    .from(s.purchases)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.purchases.supplierId))
    .where(where)
    .orderBy(desc(s.purchases.purchaseDate), desc(s.purchases.createdAt))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(case when ${s.purchases.status} = 'ACTIVE' then ${s.purchases.grandTotal} end), 0)` })
    .from(s.purchases)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.purchases.supplierId))
    .where(where);
  return {
    total: agg.total,
    amount: toPaise(agg.amount),
    rows: rows.map((r) => {
      const grand = toPaise(r.p.grandTotal);
      const paid = toPaise(r.paid);
      return { ...r.p, supplierName: r.supplierName, grand, paid, due: Math.max(grand - paid, 0) };
    }),
  };
}

export async function getPurchase(db: Executor, actor: Actor, id: string) {
  assertCan(actor, "purchases.view");
  const [row] = await db
    .select({ p: s.purchases, supplier: s.suppliers, paid: paidExpr, by: s.users.name })
    .from(s.purchases)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.purchases.supplierId))
    .leftJoin(s.users, eq(s.users.id, s.purchases.createdBy))
    .where(eq(s.purchases.id, id));
  if (!row) throw notFound("Purchase");
  const items = await db.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseId, id)).orderBy(s.purchaseItems.lineNo);
  const pays = await db.select().from(s.payments).where(eq(s.payments.purchaseId, id)).orderBy(desc(s.payments.createdAt));
  const grand = toPaise(row.p.grandTotal);
  const paid = toPaise(row.paid);
  return { ...row.p, supplier: row.supplier, by: row.by, items, payments: pays, grand, paid, due: Math.max(grand - paid, 0) };
}
