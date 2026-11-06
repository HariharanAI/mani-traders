/**
 * Builds PDF documents by id, enforcing the same access rules as the screens.
 * Generated invoice/receipt PDFs are stored and their reference recorded.
 */
import { eq, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import * as s from "./db/schema";
import { assertCan, getSettingsRow, type Actor } from "./core";
import { getSale } from "./services/sales";
import { getPayment } from "./services/payments";
import { buildReport, type ReportKey } from "./services/reports";
import { invoicePdf, receiptPdf, reportPdf } from "./pdf";
import { putFile } from "./storage";

const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-");

export async function invoiceDocument(db: DB, actor: Actor, saleId: string) {
  const sale = await getSale(db, actor, saleId);
  const settings = await getSettingsRow(db);
  const buffer = await invoicePdf(settings, sale);
  const filename = `Invoice-${safe(sale.invoiceNo)}.pdf`;
  try {
    const key = await putFile("invoices", buffer, { key: `invoices/${safe(sale.invoiceNo)}.pdf`, contentType: "application/pdf" });
    await db.update(s.invoices).set({ fileKey: key, generatedAt: new Date(), downloadCount: sql`${s.invoices.downloadCount} + 1` }).where(eq(s.invoices.saleId, saleId));
  } catch (e) {
    console.error("[invoice store]", e);
  }
  return { buffer, filename, sale, settings };
}

export async function receiptDocument(db: DB, actor: Actor, paymentId: string) {
  const p = await getPayment(db, actor, paymentId);
  const settings = await getSettingsRow(db);
  const buffer = await receiptPdf(settings, p);
  const filename = `${p.direction === "IN" ? "Receipt" : "Voucher"}-${safe(p.paymentNo)}.pdf`;
  if (p.direction === "IN") {
    try {
      const key = await putFile("receipts-pdf", buffer, { key: `receipts-pdf/${safe(p.paymentNo)}.pdf`, contentType: "application/pdf" });
      await db.update(s.receipts).set({ fileKey: key, generatedAt: new Date() }).where(eq(s.receipts.paymentId, paymentId));
    } catch (e) {
      console.error("[receipt store]", e);
    }
  }
  return { buffer, filename, payment: p, settings };
}

export async function statementDocument(db: DB, actor: Actor, partyType: "CUSTOMER" | "SUPPLIER", partyId: string, range: { from: string; to: string }) {
  assertCan(actor, "ledger.view");
  const report = await buildReport(db, actor, partyType === "CUSTOMER" ? "customer-statement" : "supplier-statement", range, { partyId });
  const settings = await getSettingsRow(db);
  const buffer = await reportPdf(settings, report, { generatedBy: actor.name });
  return { buffer, filename: `Statement-${safe(report.title.split("—")[1]?.trim() ?? "party")}-${range.to}.pdf`, report, settings };
}

export async function reportDocument(db: DB, actor: Actor, key: ReportKey, range: { from: string; to: string }, opts: { partyId?: string; q?: string }) {
  const report = await buildReport(db, actor, key, range, opts);
  const settings = await getSettingsRow(db);
  return { report, settings };
}
