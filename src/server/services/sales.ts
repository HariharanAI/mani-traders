/**
 * Sales: invoice creation (cash / credit / partial), cancellation with
 * reversal, and sales returns (credit notes). Totals are always recomputed on
 * the server from the submitted lines — client totals are never trusted.
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
  reverseJournal,
  reverseLedgerTxnRow,
  type Actor,
  type PostingLine,
} from "../core";
import { ACC, moneyAccountFor, PAYMENT_METHOD_LABEL } from "@/lib/accounts";
import { cancelSchema, saleReturnSchema, saleSchema, type SaleInput } from "@/lib/validators";
import { computeBill, type TaxMode } from "@/lib/gst";
import { formatINR, fromMilli, fromPaise, lineAmount, proportion, toMilli, toPaise, type Paise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { applyMovement, allowNegativeFor } from "./inventory";
import { recordPaymentTx, reversePaymentTx } from "./payments";
import { customerScope, getCustomerForActor } from "./parties";
import { notify } from "./notifications";

export function salesTaxMode(settings: { gstRegistered: boolean; gstScheme: string; pricesIncludeTax: boolean }): TaxMode {
  if (!settings.gstRegistered || settings.gstScheme === "COMPOSITION") return "NONE";
  return settings.pricesIncludeTax ? "INCLUSIVE" : "EXCLUSIVE";
}

export async function createSale(db: DB, actor: Actor, raw: SaleInput) {
  assertCan(actor, "sales.create");
  const input = saleSchema.parse(raw);
  const [dup] = await db.select().from(s.sales).where(eq(s.sales.idempotencyKey, input.idempotencyKey));
  if (dup) return { sale: dup, duplicate: true };

  const sale = await db.transaction(async (tx) => {
    const settings = await getSettingsRow(tx);
    const taxMode = salesTaxMode(settings);
    const customer = input.customerId ? await getCustomerForActor(tx, actor, input.customerId) : null;
    if (customer?.archivedAt) throw new AppError("This customer is archived. Restore them first.");
    const interstate = !!(taxMode !== "NONE" && customer?.stateCode && settings.stateCode && customer.stateCode !== settings.stateCode);

    // Load products referenced by lines
    const productIds = [...new Set(input.lines.map((l) => l.productId).filter(Boolean) as string[])];
    const products = productIds.length ? await tx.select().from(s.products).where(inArray(s.products.id, productIds)) : [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) if (!productMap.get(id) || productMap.get(id)!.archivedAt) throw new AppError("One of the products is not available.");

    let bill;
    try {
      bill = computeBill(input.lines, taxMode, interstate, true);
    } catch (e) {
      throw new AppError((e as Error).message);
    }
    if (bill.grandTotal <= 0) throw new AppError("Invoice total must be greater than zero.");
    const received = toPaise(input.amountReceived);
    if (received > bill.grandTotal) throw new AppError(`Amount received cannot exceed the invoice total (${formatINR(bill.grandTotal)}). Record extra money as a separate payment.`, { amountReceived: "Too high" });
    if (!customer && received !== bill.grandTotal) throw new AppError("Walk-in sales must be fully paid. Select or add a customer for credit sales.", { amountReceived: "Must equal total" });

    const saleId = crypto.randomUUID();
    const invoiceNo = await nextDocNumber(tx, "invoice", input.date);
    const allowNeg = await allowNegativeFor(tx, actor, input.allowNegativeStock);

    // Stock out at moving-average cost
    let costTotal = 0;
    const lineCosts: Paise[] = [];
    for (const [i, l] of input.lines.entries()) {
      if (!l.productId) {
        lineCosts.push(0);
        continue;
      }
      const qty = bill.lines[i].qtyMilli;
      const res = await applyMovement(tx, actor, {
        productId: l.productId,
        qtyMilli: -qty,
        type: "SALE",
        date: input.date,
        sourceType: "SALE",
        sourceId: saleId,
        reason: `Invoice ${invoiceNo}`,
        allowNegative: allowNeg,
      });
      lineCosts.push(res.unitCost);
      costTotal += lineAmount(qty, res.unitCost);
    }

    const party = customer ? { type: "CUSTOMER" as const, id: customer.id } : null;
    const debitAccount = customer ? ACC.RECEIVABLE : moneyAccountFor(input.paymentMethod);
    const lines: PostingLine[] = [
      { account: debitAccount, party, debit: bill.grandTotal },
      { account: ACC.SALES, credit: bill.taxableTotal },
      { account: ACC.GST_OUTPUT, credit: bill.taxTotal },
      // grandTotal = taxable + tax + roundOff → positive roundOff is income
      { account: ACC.ROUND_OFF, credit: bill.roundOff > 0 ? bill.roundOff : 0, debit: bill.roundOff < 0 ? -bill.roundOff : 0 },
      { account: ACC.COGS, debit: costTotal },
      { account: ACC.INVENTORY, credit: costTotal },
    ];
    const je = await postJournal(tx, actor, {
      date: input.date,
      memo: `Sale ${invoiceNo} — ${customer?.name ?? input.walkInName ?? "Walk-in customer"}`,
      sourceType: "SALE",
      sourceId: saleId,
      lines,
    });

    const [row] = await tx
      .insert(s.sales)
      .values({
        id: saleId,
        invoiceNo,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? input.walkInName ?? "Walk-in customer",
        customerMobile: customer?.mobile ?? input.walkInMobile ?? null,
        customerAddress: customer?.address ?? null,
        customerGstin: customer?.gstin ?? null,
        saleDate: input.date,
        placeOfSupply: customer?.stateCode ?? settings.stateCode ?? null,
        isInterstate: interstate,
        taxMode,
        subtotal: fromPaise(bill.subtotal),
        discountTotal: fromPaise(bill.discountTotal),
        taxableTotal: fromPaise(bill.taxableTotal),
        cgstTotal: fromPaise(bill.cgstTotal),
        sgstTotal: fromPaise(bill.sgstTotal),
        igstTotal: fromPaise(bill.igstTotal),
        roundOff: fromPaise(bill.roundOff),
        grandTotal: fromPaise(bill.grandTotal),
        costTotal: fromPaise(costTotal),
        notes: input.notes,
        journalEntryId: je.id,
        idempotencyKey: input.idempotencyKey,
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(s.saleItems).values(
      input.lines.map((l, i) => {
        const r = bill.lines[i];
        const p = l.productId ? productMap.get(l.productId) : undefined;
        return {
          saleId,
          lineNo: i + 1,
          productId: l.productId ?? null,
          description: l.description,
          hsnCode: l.hsnCode ?? p?.hsnCode ?? null,
          unit: l.unit || p?.unit || "pcs",
          quantity: fromMilli(r.qtyMilli),
          rate: fromPaise(r.rate),
          discount: fromPaise(r.discount),
          taxable: fromPaise(r.taxable),
          gstRate: fromPaise(r.gstRate),
          cgst: fromPaise(r.cgst),
          sgst: fromPaise(r.sgst),
          igst: fromPaise(r.igst),
          total: fromPaise(r.total),
          unitCost: fromPaise(lineCosts[i]),
        };
      }),
    );
    await tx.insert(s.invoices).values({ invoiceNo, saleId, customerId: customer?.id ?? null, invoiceDate: input.date, grandTotal: fromPaise(bill.grandTotal) });

    if (customer) {
      await insertLedgerTxn(tx, actor, {
        party: party!,
        date: input.date,
        type: "SALE",
        description: `Sale — Invoice ${invoiceNo}`,
        amount: bill.grandTotal,
        balanceEffect: bill.grandTotal,
        journalEntryId: je.id,
        referenceNo: invoiceNo,
        sourceType: "SALE",
        sourceId: saleId,
      });
      if (received > 0) {
        await recordPaymentTx(tx, actor, {
          direction: "IN",
          party: party!,
          amount: received,
          method: input.paymentMethod,
          date: input.date,
          referenceNo: input.paymentReference,
          saleId,
          description: `Payment for invoice ${invoiceNo} (${PAYMENT_METHOD_LABEL[input.paymentMethod]})`,
        });
      }
    } else {
      // Walk-in: money received is part of the sale entry itself.
      const paymentNo = await nextDocNumber(tx, "receipt", input.date);
      const [pay] = await tx
        .insert(s.payments)
        .values({
          paymentNo,
          direction: "IN",
          partyType: null,
          partyId: null,
          paymentDate: input.date,
          amount: fromPaise(received),
          method: input.paymentMethod,
          referenceNo: input.paymentReference,
          saleId,
          balanceAfter: "0",
          journalEntryId: je.id,
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(s.receipts).values({ receiptNo: paymentNo, paymentId: pay.id });
    }

    await audit(tx, actor, "CREATE", "sale", saleId, `Invoice ${invoiceNo}: ${formatINR(bill.grandTotal)} — ${row.customerName}`, { after: row });
    await notify(tx, {
      type: "SALE",
      title: `New sale ${invoiceNo}: ${formatINR(bill.grandTotal)}`,
      body: `${row.customerName} · ${received >= bill.grandTotal ? "Paid" : received > 0 ? `Paid ${formatINR(received)}` : "On credit"} · by ${actor.name}`,
      link: `/sales/${saleId}`,
      severity: "success",
    });
    if (bill.grandTotal >= toPaise(settings.unusualTxnThreshold)) {
      await notify(tx, { type: "UNUSUAL", title: `Large sale: ${formatINR(bill.grandTotal)}`, body: `${invoiceNo} · ${row.customerName} · by ${actor.name}`, link: `/sales/${saleId}`, severity: "warning" });
    }
    return row;
  });
  return { sale, duplicate: false };
}

export async function cancelSale(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "sales.cancel");
  const input = cancelSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [sale] = await tx.select().from(s.sales).where(eq(s.sales.id, input.id)).for("update");
    if (!sale) throw notFound("Invoice");
    if (sale.customerId) await getCustomerForActor(tx, actor, sale.customerId);
    if (sale.status !== "ACTIVE") throw new AppError("This invoice is already cancelled.", undefined, "CONFLICT");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.saleReturns).where(eq(s.saleReturns.saleId, sale.id));
    if (n > 0) throw new AppError("This invoice has returns recorded. It cannot be cancelled; record a further return instead.");
    const today = todayIST();
    const reason = `Invoice ${sale.invoiceNo} cancelled: ${input.reason}`;

    if (sale.customerId) {
      const [lt] = await tx.select().from(s.ledgerTransactions).where(and(eq(s.ledgerTransactions.sourceType, "SALE"), eq(s.ledgerTransactions.sourceId, sale.id), eq(s.ledgerTransactions.status, "ACTIVE")));
      if (!lt) throw new Error("Sale ledger entry missing");
      await reverseLedgerTxnRow(tx, actor, lt.id, reason, today); // reverses the sale journal too
      if (input.reversePayments) {
        const pays = await tx.select().from(s.payments).where(and(eq(s.payments.saleId, sale.id), eq(s.payments.status, "ACTIVE"), eq(s.payments.direction, "IN")));
        for (const p of pays) await reversePaymentTx(tx, actor, p.id, `${reason} (payment refunded)`);
      }
    } else {
      await reverseJournal(tx, actor, sale.journalEntryId!, reason, today);
      await tx.update(s.payments).set({ status: "REVERSED" }).where(and(eq(s.payments.saleId, sale.id), eq(s.payments.status, "ACTIVE")));
    }
    // Return stock at the cost it left with
    const items = await tx.select().from(s.saleItems).where(eq(s.saleItems.saleId, sale.id));
    for (const it of items) {
      if (!it.productId) continue;
      await applyMovement(tx, actor, {
        productId: it.productId,
        qtyMilli: toMilli(it.quantity),
        type: "SALE_CANCEL",
        date: today,
        unitCost: toPaise(it.unitCost),
        sourceType: "SALE",
        sourceId: sale.id,
        reason,
      });
    }
    await tx.update(s.sales).set({ status: "CANCELLED", cancelledAt: new Date(), cancelledBy: actor.id, cancelReason: input.reason }).where(eq(s.sales.id, sale.id));
    await tx.update(s.invoices).set({ status: "CANCELLED" }).where(eq(s.invoices.saleId, sale.id));
    await audit(tx, actor, "CANCEL", "sale", sale.id, reason, { before: sale });
    await notify(tx, { type: "REVERSAL", title: `Invoice ${sale.invoiceNo} cancelled`, body: `${formatINR(toPaise(sale.grandTotal))} · ${input.reason} · by ${actor.name}`, link: `/sales/${sale.id}`, severity: "warning" });
  });
}

export async function createSaleReturn(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "sales.return");
  const input = saleReturnSchema.parse(raw);
  const [dupe] = await db.select({ id: s.auditLogs.id }).from(s.auditLogs).where(and(eq(s.auditLogs.action, "RETURN"), eq(s.auditLogs.entityId, `idem:${input.idempotencyKey}`)));
  if (dupe) return { duplicate: true };
  return db.transaction(async (tx) => {
    const [sale] = await tx.select().from(s.sales).where(eq(s.sales.id, input.saleId)).for("update");
    if (!sale) throw notFound("Invoice");
    if (sale.status !== "ACTIVE") throw new AppError("Cannot return items on a cancelled invoice.");
    if (sale.customerId) await getCustomerForActor(tx, actor, sale.customerId);
    const items = await tx.select().from(s.saleItems).where(eq(s.saleItems.saleId, sale.id));
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const returnId = crypto.randomUUID();
    const returnNo = await nextDocNumber(tx, "creditnote", input.date);
    let taxable = 0;
    let tax = 0;
    let cost = 0;
    const retLines: { saleItemId: string; qty: number; taxable: number; tax: number; total: number }[] = [];
    for (const r of input.items) {
      const qty = toMilli(r.quantity);
      if (qty <= 0) continue;
      const it = itemMap.get(r.saleItemId);
      if (!it) throw new AppError("Invalid item in return.");
      const sold = toMilli(it.quantity);
      const already = toMilli(it.returnedQty);
      if (qty > sold - already) throw new AppError(`Cannot return more than ${fromMilli(sold - already).replace(/\.?0+$/, "")} of ${it.description}.`);
      const lt = proportion(toPaise(it.taxable), qty, sold);
      const ltax = proportion(toPaise(it.cgst) + toPaise(it.sgst) + toPaise(it.igst), qty, sold);
      taxable += lt;
      tax += ltax;
      cost += lineAmount(qty, toPaise(it.unitCost));
      retLines.push({ saleItemId: it.id, qty, taxable: lt, tax: ltax, total: lt + ltax });
      await tx.update(s.saleItems).set({ returnedQty: fromMilli(already + qty) }).where(eq(s.saleItems.id, it.id));
      if (it.productId) {
        await applyMovement(tx, actor, { productId: it.productId, qtyMilli: qty, type: "SALE_RETURN", date: input.date, unitCost: toPaise(it.unitCost), sourceType: "SALE_RETURN", sourceId: returnId, reason: `Credit note ${returnNo}` });
      }
    }
    if (!retLines.length) throw new AppError("Enter a quantity to return.");
    const total = taxable + tax;
    const refund = sale.customerId ? toPaise(input.refundAmount) : total;
    if (refund > total) throw new AppError("Refund cannot exceed the return value.");
    const party = sale.customerId ? { type: "CUSTOMER" as const, id: sale.customerId } : null;

    const je = await postJournal(tx, actor, {
      date: input.date,
      memo: `Sales return ${returnNo} against ${sale.invoiceNo}`,
      sourceType: "SALE_RETURN",
      sourceId: returnId,
      lines: [
        { account: ACC.SALES_RETURNS, debit: taxable },
        { account: ACC.GST_OUTPUT, debit: tax },
        { account: party ? ACC.RECEIVABLE : moneyAccountFor(input.refundMethod), party, credit: total },
        { account: ACC.INVENTORY, debit: cost },
        { account: ACC.COGS, credit: cost },
      ],
    });
    await tx.insert(s.saleReturns).values({
      id: returnId,
      returnNo,
      saleId: sale.id,
      customerId: sale.customerId,
      returnDate: input.date,
      taxableTotal: fromPaise(taxable),
      taxTotal: fromPaise(tax),
      grandTotal: fromPaise(total),
      costTotal: fromPaise(cost),
      refundAmount: fromPaise(refund),
      refundMethod: refund > 0 ? input.refundMethod : null,
      reason: input.reason,
      journalEntryId: je.id,
      createdBy: actor.id,
    });
    await tx.insert(s.saleReturnItems).values(retLines.map((l) => ({ saleReturnId: returnId, saleItemId: l.saleItemId, quantity: fromMilli(l.qty), taxable: fromPaise(l.taxable), tax: fromPaise(l.tax), total: fromPaise(l.total) })));

    if (party) {
      await insertLedgerTxn(tx, actor, {
        party,
        date: input.date,
        type: "SALES_RETURN",
        description: `Sales return ${returnNo} (invoice ${sale.invoiceNo})`,
        amount: total,
        balanceEffect: -total,
        journalEntryId: je.id,
        referenceNo: returnNo,
        notes: input.reason,
        sourceType: "SALE_RETURN",
        sourceId: returnId,
      });
      if (refund > 0) {
        await recordPaymentTx(tx, actor, { direction: "OUT", party, amount: refund, method: input.refundMethod, date: input.date, referenceNo: returnNo, description: `Refund for return ${returnNo}` });
      }
    } else {
      const paymentNo = await nextDocNumber(tx, "voucher", input.date);
      await tx.insert(s.payments).values({ paymentNo, direction: "OUT", paymentDate: input.date, amount: fromPaise(refund), method: input.refundMethod, referenceNo: returnNo, saleId: sale.id, journalEntryId: je.id, createdBy: actor.id, notes: `Refund for return ${returnNo}` });
    }
    await audit(tx, actor, "RETURN", "sale", `idem:${input.idempotencyKey}`, `Sales return ${returnNo}: ${formatINR(total)} against ${sale.invoiceNo}`);
    return { duplicate: false, returnNo };
  });
}

// ---------------------------------------------------------------- queries
const paidExpr = sql<string>`coalesce((select sum(p.amount) from payments p where p.sale_id = ${s.sales.id} and p.status = 'ACTIVE' and p.direction = 'IN'), 0)`;
const returnedExpr = sql<string>`coalesce((select sum(r.grand_total) from sale_returns r where r.sale_id = ${s.sales.id}), 0)`;

export async function listSales(
  db: Executor,
  actor: Actor,
  f: { q?: string; from?: string; to?: string; status?: "all" | "paid" | "partial" | "unpaid" | "cancelled"; customerId?: string; limit?: number; offset?: number } = {},
) {
  assertCan(actor, "sales.view");
  const scope = customerScope(actor);
  const due = sql`(${s.sales.grandTotal} - ${paidExpr} - ${returnedExpr})`;
  const where = and(
    f.from ? sql`${s.sales.saleDate} >= ${f.from}` : undefined,
    f.to ? sql`${s.sales.saleDate} <= ${f.to}` : undefined,
    f.customerId ? eq(s.sales.customerId, f.customerId) : undefined,
    f.q ? or(ilike(s.sales.invoiceNo, `%${f.q}%`), ilike(s.sales.customerName, `%${f.q}%`), ilike(s.sales.customerMobile, `%${f.q}%`)) : undefined,
    f.status === "cancelled" ? eq(s.sales.status, "CANCELLED") : f.status && f.status !== "all" ? eq(s.sales.status, "ACTIVE") : undefined,
    f.status === "paid" ? sql`${due} <= 0` : undefined,
    f.status === "partial" ? sql`${due} > 0 and ${paidExpr} > 0` : undefined,
    f.status === "unpaid" ? sql`${paidExpr} = 0 and ${due} > 0` : undefined,
    scope ? sql`(${s.sales.createdBy} = ${actor.id} or ${s.sales.customerId} in (select id from customers where assigned_to = ${actor.id}))` : undefined,
  );
  const rows = await db
    .select({ s: s.sales, paid: paidExpr, returned: returnedExpr, by: s.users.name })
    .from(s.sales)
    .leftJoin(s.users, eq(s.users.id, s.sales.createdBy))
    .where(where)
    .orderBy(desc(s.sales.saleDate), desc(s.sales.createdAt))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [agg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(case when ${s.sales.status} = 'ACTIVE' then ${s.sales.grandTotal} end), 0)`,
      due: sql<string>`coalesce(sum(case when ${s.sales.status} = 'ACTIVE' then greatest(${due}, 0) end), 0)`,
    })
    .from(s.sales)
    .where(where);
  return {
    total: agg.total,
    amount: toPaise(agg.amount),
    due: toPaise(agg.due),
    rows: rows.map((r) => {
      const grand = toPaise(r.s.grandTotal);
      const paid = toPaise(r.paid);
      const returned = toPaise(r.returned);
      const dueP = Math.max(grand - paid - returned, 0);
      return { ...r.s, grand, paid, returned, due: dueP, by: r.by, payStatus: r.s.status !== "ACTIVE" ? "CANCELLED" : dueP <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID" };
    }),
  };
}

export async function getSale(db: Executor, actor: Actor, id: string) {
  assertCan(actor, "sales.view");
  const [row] = await db.select({ s: s.sales, by: s.users.name, paid: paidExpr, returned: returnedExpr }).from(s.sales).leftJoin(s.users, eq(s.users.id, s.sales.createdBy)).where(eq(s.sales.id, id));
  if (!row) throw notFound("Invoice");
  if (row.s.customerId) await getCustomerForActor(db, actor, row.s.customerId);
  const items = await db.select().from(s.saleItems).where(eq(s.saleItems.saleId, id)).orderBy(s.saleItems.lineNo);
  const pays = await db.select().from(s.payments).where(eq(s.payments.saleId, id)).orderBy(desc(s.payments.createdAt));
  const returns = await db.select().from(s.saleReturns).where(eq(s.saleReturns.saleId, id)).orderBy(desc(s.saleReturns.createdAt));
  const customer = row.s.customerId ? (await db.select().from(s.customers).where(eq(s.customers.id, row.s.customerId)))[0] : null;
  const grand = toPaise(row.s.grandTotal);
  const paid = toPaise(row.paid);
  const returned = toPaise(row.returned);
  return { ...row.s, by: row.by, items, payments: pays, returns, customer, grand, paid, returned, due: Math.max(grand - paid - returned, 0) };
}
