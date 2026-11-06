import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Executor } from "../db/client";
import * as s from "../db/schema";
import { can, type Actor } from "../core";
import { customerScope } from "./parties";
import { formatQty, toMilli, toPaise } from "@/lib/money";

export type SearchHit = { type: "customer" | "supplier" | "invoice" | "product" | "transaction" | "payment" | "purchase"; id: string; title: string; subtitle: string; href: string; amount?: number };

/** Global search across customers, suppliers, invoices, products, khata transaction IDs and payment numbers. */
export async function globalSearch(db: Executor, actor: Actor, raw: string): Promise<SearchHit[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const hits: SearchHit[] = [];

  if (can(actor, "customers.view")) {
    const rows = await db
      .select({ id: s.customers.id, name: s.customers.name, code: s.customers.code, mobile: s.customers.mobile })
      .from(s.customers)
      .where(and(customerScope(actor), isNull(s.customers.archivedAt), or(ilike(s.customers.name, like), ilike(s.customers.code, like), digits.length >= 3 ? ilike(s.customers.mobile, `%${digits}%`) : undefined)))
      .limit(6);
    hits.push(...rows.map((r) => ({ type: "customer" as const, id: r.id, title: r.name, subtitle: `${r.code}${r.mobile ? " · " + r.mobile : ""}`, href: `/customers/${r.id}` })));
  }
  if (can(actor, "suppliers.view")) {
    const rows = await db
      .select({ id: s.suppliers.id, name: s.suppliers.name, code: s.suppliers.code, mobile: s.suppliers.mobile })
      .from(s.suppliers)
      .where(and(isNull(s.suppliers.archivedAt), or(ilike(s.suppliers.name, like), ilike(s.suppliers.code, like), digits.length >= 3 ? ilike(s.suppliers.mobile, `%${digits}%`) : undefined)))
      .limit(5);
    hits.push(...rows.map((r) => ({ type: "supplier" as const, id: r.id, title: r.name, subtitle: `Supplier · ${r.code}${r.mobile ? " · " + r.mobile : ""}`, href: `/suppliers/${r.id}` })));
  }
  if (can(actor, "sales.view")) {
    const scope = customerScope(actor);
    const rows = await db
      .select({ id: s.sales.id, invoiceNo: s.sales.invoiceNo, name: s.sales.customerName, total: s.sales.grandTotal, date: s.sales.saleDate, status: s.sales.status })
      .from(s.sales)
      .where(and(or(ilike(s.sales.invoiceNo, like), ilike(s.sales.customerName, like)), scope ? sql`(${s.sales.createdBy} = ${actor.id} or ${s.sales.customerId} in (select id from customers where assigned_to = ${actor.id}))` : undefined))
      .orderBy(desc(s.sales.createdAt))
      .limit(6);
    hits.push(...rows.map((r) => ({ type: "invoice" as const, id: r.id, title: r.invoiceNo, subtitle: `${r.name}${r.status === "CANCELLED" ? " · cancelled" : ""}`, href: `/sales/${r.id}`, amount: toPaise(r.total) })));
  }
  if (can(actor, "purchases.view")) {
    const rows = await db
      .select({ id: s.purchases.id, no: s.purchases.purchaseNo, bill: s.purchases.supplierInvoiceNo, total: s.purchases.grandTotal })
      .from(s.purchases)
      .where(or(ilike(s.purchases.purchaseNo, like), ilike(s.purchases.supplierInvoiceNo, like)))
      .limit(4);
    hits.push(...rows.map((r) => ({ type: "purchase" as const, id: r.id, title: r.no, subtitle: r.bill ? `Supplier bill ${r.bill}` : "Purchase", href: `/purchases/${r.id}`, amount: toPaise(r.total) })));
  }
  if (can(actor, "inventory.view")) {
    const rows = await db
      .select({ id: s.products.id, name: s.products.name, code: s.products.code, sku: s.products.sku, stock: s.products.stockQty, unit: s.products.unit })
      .from(s.products)
      .where(and(isNull(s.products.archivedAt), or(ilike(s.products.name, like), ilike(s.products.sku, like), eq(s.products.barcode, q), ilike(s.products.code, like))))
      .limit(5);
    hits.push(...rows.map((r) => ({ type: "product" as const, id: r.id, title: r.name, subtitle: `${r.sku ?? r.code} · ${formatQty(toMilli(r.stock))} ${r.unit} in stock`, href: `/inventory/${r.id}` })));
  }
  if (can(actor, "ledger.view") && /^t-?\d+/i.test(q)) {
    const rows = await db
      .select({ id: s.ledgerTransactions.id, txnNo: s.ledgerTransactions.txnNo, partyType: s.ledgerTransactions.partyType, partyId: s.ledgerTransactions.partyId, desc: s.ledgerTransactions.description, amount: s.ledgerTransactions.amount })
      .from(s.ledgerTransactions)
      .where(ilike(s.ledgerTransactions.txnNo, like))
      .limit(5);
    for (const r of rows) {
      if (r.partyType === "CUSTOMER" && !can(actor, "customers.view_all")) {
        const [ok] = await db.select({ id: s.customers.id }).from(s.customers).where(and(eq(s.customers.id, r.partyId), eq(s.customers.assignedTo, actor.id)));
        if (!ok) continue;
      }
      if (r.partyType === "SUPPLIER" && !can(actor, "suppliers.view")) continue;
      hits.push({ type: "transaction", id: r.id, title: r.txnNo, subtitle: r.desc, href: `/${r.partyType === "CUSTOMER" ? "customers" : "suppliers"}/${r.partyId}?txn=${r.txnNo}`, amount: toPaise(r.amount) });
    }
  }
  if (can(actor, "payments.receive") || can(actor, "payments.make")) {
    const rows = await db
      .select({ id: s.payments.id, no: s.payments.paymentNo, amount: s.payments.amount, ref: s.payments.referenceNo, partyType: s.payments.partyType })
      .from(s.payments)
      .where(or(ilike(s.payments.paymentNo, like), ilike(s.payments.referenceNo, like)))
      .limit(4);
    hits.push(...rows.filter((r) => r.partyType !== "SUPPLIER" || can(actor, "suppliers.view")).map((r) => ({ type: "payment" as const, id: r.id, title: r.no, subtitle: r.ref ? `Ref ${r.ref}` : "Payment", href: `/payments/${r.id}`, amount: toPaise(r.amount) })));
  }
  return hits;
}
