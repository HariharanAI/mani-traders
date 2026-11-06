"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { runAction } from "@/server/auth/session";
import { AppError, getSettingsRow } from "@/server/core";
import { assertPartyAccess, partySummary } from "@/server/services/parties";
import { getSale } from "@/server/services/sales";
import { getPayment } from "@/server/services/payments";
import { cloudConfigured, composeMessage, logManualShare, sendCloud, waLink, type MessageType } from "@/server/services/whatsapp";
import { invoiceDocument, receiptDocument, statementDocument } from "@/server/documents";
import { addMonths, endOfMonth, monthLabel, startOfMonth, todayIST } from "@/lib/dates";
import { toPaise } from "@/lib/money";

type Target =
  | { kind: "party"; type: MessageType; partyType: "CUSTOMER" | "SUPPLIER"; partyId: string }
  | { kind: "invoice"; saleId: string }
  | { kind: "receipt"; paymentId: string };

/** Builds the message for a target. Used for the preview and for sending. */
async function prepare(target: Target) {
  const db = await getDb();
  const settings = await getSettingsRow(db);
  return { db, settings };
}

export async function prepareMessageAction(target: Target) {
  return runAction(["messages.send"], async (actor) => {
    const { db, settings } = await prepare(target);
    const business = settings.businessName;
    if (target.kind === "party") {
      const party = await assertPartyAccess(db, actor, { type: target.partyType, id: target.partyId });
      const sum = await partySummary(db, { type: target.partyType, id: target.partyId });
      const month = monthLabel(addMonths(startOfMonth(todayIST()), -1).slice(0, 7));
      const msg = composeMessage(target.type, { business, name: party.name, balance: sum.balance, month, upiId: settings.upiId });
      return { to: party.whatsapp || party.mobile || "", text: msg.text, type: target.type, cloud: settings.whatsappMode === "CLOUD_API" && cloudConfigured(), hasPdf: target.type === "STATEMENT" || target.type === "MONTHLY_SUMMARY" };
    }
    if (target.kind === "invoice") {
      const sale = await getSale(db, actor, target.saleId);
      const msg = composeMessage("INVOICE", { business, name: sale.customerName, docNo: sale.invoiceNo, amount: sale.grand, balance: sale.due });
      return { to: sale.customer?.whatsapp || sale.customer?.mobile || sale.customerMobile || "", text: msg.text, type: "INVOICE" as const, cloud: settings.whatsappMode === "CLOUD_API" && cloudConfigured(), hasPdf: true };
    }
    const p = await getPayment(db, actor, target.paymentId);
    const msg = composeMessage(p.direction === "IN" ? "PAYMENT_CONFIRMATION" : "RECEIPT", { business, name: p.party?.name ?? "Customer", amount: p.amountP, docNo: p.paymentNo, date: p.paymentDate, balance: toPaise(p.balanceAfter) });
    return { to: p.party?.whatsapp || p.party?.mobile || "", text: msg.text, type: "RECEIPT" as MessageType, cloud: settings.whatsappMode === "CLOUD_API" && cloudConfigured(), hasPdf: true };
  });
}

/** mode "manual": log + return wa.me link. mode "cloud": send through the API and report the real result. */
export async function sendMessageAction(target: Target, opts: { mode: "manual" | "cloud"; to: string; text: string; attachPdf: boolean }) {
  return runAction(["messages.send"], async (actor) => {
    const { db } = await prepare(target);
    let party: { type: "CUSTOMER" | "SUPPLIER"; id: string } | null = null;
    let type: MessageType;
    let pdf: { buffer: Buffer; filename: string; ref: string } | null = null;
    let params: string[] = [];
    const settings = await getSettingsRow(db);
    if (target.kind === "party") {
      party = { type: target.partyType, id: target.partyId };
      type = target.type;
      const p = await assertPartyAccess(db, actor, party);
      const sum = await partySummary(db, party);
      params = composeMessage(type, { business: settings.businessName, name: p.name, balance: sum.balance, month: monthLabel(addMonths(startOfMonth(todayIST()), -1).slice(0, 7)) }).params;
      if (opts.attachPdf && opts.mode === "cloud" && (type === "STATEMENT" || type === "MONTHLY_SUMMARY")) {
        const range = type === "MONTHLY_SUMMARY" ? { from: addMonths(startOfMonth(todayIST()), -1), to: endOfMonth(addMonths(startOfMonth(todayIST()), -1)) } : { from: "2000-01-01", to: todayIST() };
        const d = await statementDocument(db, actor, target.partyType, target.partyId, range);
        pdf = { buffer: d.buffer, filename: d.filename, ref: `statement:${target.partyId}` };
      }
    } else if (target.kind === "invoice") {
      const sale = await getSale(db, actor, target.saleId);
      type = "INVOICE";
      party = sale.customerId ? { type: "CUSTOMER", id: sale.customerId } : null;
      params = composeMessage("INVOICE", { business: settings.businessName, name: sale.customerName, docNo: sale.invoiceNo, amount: sale.grand }).params;
      if (opts.attachPdf && opts.mode === "cloud") {
        const d = await invoiceDocument(db, actor, target.saleId);
        pdf = { buffer: d.buffer, filename: d.filename, ref: `invoice:${sale.invoiceNo}` };
      }
    } else {
      const p = await getPayment(db, actor, target.paymentId);
      type = "RECEIPT";
      party = p.partyType && p.partyId ? { type: p.partyType, id: p.partyId } : null;
      params = composeMessage("RECEIPT", { business: settings.businessName, name: p.party?.name ?? "Customer", amount: p.amountP }).params;
      if (opts.attachPdf && opts.mode === "cloud") {
        const d = await receiptDocument(db, actor, target.paymentId);
        pdf = { buffer: d.buffer, filename: d.filename, ref: `receipt:${p.paymentNo}` };
      }
    }
    if (!opts.to.replace(/\D/g, "")) throw new AppError("Enter a WhatsApp number.");
    revalidatePath("/notifications");
    if (opts.mode === "manual") {
      await logManualShare(db, actor, { type, to: opts.to, party, body: opts.text });
      return { mode: "manual" as const, link: waLink(opts.to, opts.text) };
    }
    const res = await sendCloud(db, actor, { type, to: opts.to, party, text: opts.text, params, pdf });
    if (!res.ok) return { ok: false as const, error: `WhatsApp did not accept the message: ${res.error}` };
    return { mode: "cloud" as const, status: res.log.status };
  });
}
