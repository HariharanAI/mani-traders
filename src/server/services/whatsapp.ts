/**
 * WhatsApp messaging.
 *
 * CLOUD_API mode (WhatsApp Business Cloud API, env-configured):
 *   - Business-initiated messages must use Meta-approved templates. Template
 *     names per message type are configured in Settings → WhatsApp.
 *   - Free-form text only works inside the 24h customer-service window; Meta
 *     rejects it otherwise and we record that failure verbatim.
 *   - PDFs are uploaded to Meta media and attached as the template's document
 *     header (template must have a DOCUMENT header) or sent as a document message.
 *   - Status starts at SENT only after Meta returns a message id; DELIVERED /
 *     READ / FAILED come exclusively from the signed webhook.
 * MANUAL mode (always available): opens WhatsApp (wa.me / share sheet) with the
 *   message pre-filled. Logged as MANUAL_OPENED — never claimed as delivered.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import { AppError, assertCan, getSettingsRow, type Actor } from "../core";
import { normalizePhone } from "@/lib/utils";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const MESSAGE_TYPES = [
  { key: "REMINDER", label: "Outstanding reminder", params: "{{1}} customer name, {{2}} amount due" },
  { key: "PAYMENT_CONFIRMATION", label: "Payment confirmation", params: "{{1}} name, {{2}} amount, {{3}} balance" },
  { key: "STATEMENT", label: "Ledger statement (PDF)", params: "{{1}} name, {{2}} balance — DOCUMENT header" },
  { key: "INVOICE", label: "Invoice (PDF)", params: "{{1}} name, {{2}} invoice no., {{3}} amount — DOCUMENT header" },
  { key: "RECEIPT", label: "Payment receipt (PDF)", params: "{{1}} name, {{2}} amount — DOCUMENT header" },
  { key: "MONTHLY_SUMMARY", label: "Monthly account summary", params: "{{1}} name, {{2}} month, {{3}} balance" },
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number]["key"];

export function cloudConfigured() {
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}
const graph = (p: string) => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${p}`;

// ---------------------------------------------------------------- message text
export function composeMessage(
  type: MessageType,
  d: { business: string; name: string; amount?: number; balance?: number; docNo?: string; month?: string; date?: string; upiId?: string | null },
): { text: string; params: string[] } {
  const sign = `\n\n— ${d.business}`;
  switch (type) {
    case "REMINDER":
      return {
        text: `Hello ${d.name},\n\nYour current outstanding balance with ${d.business} is ${formatINR(d.balance ?? 0)}.\n\nPlease settle the pending amount at your convenience.${d.upiId ? `\nUPI: ${d.upiId}` : ""}\n\nThank you for your business.${sign}`,
        params: [d.name, formatINR(d.balance ?? 0)],
      };
    case "PAYMENT_CONFIRMATION":
      return {
        text: `Hello ${d.name},\n\nWe have received your payment of ${formatINR(d.amount ?? 0)}${d.date ? ` on ${formatDate(d.date)}` : ""}${d.docNo ? ` (Receipt ${d.docNo})` : ""}. Thank you!\n\n${(d.balance ?? 0) > 0 ? `Remaining balance: ${formatINR(d.balance ?? 0)}` : (d.balance ?? 0) < 0 ? `Advance with us: ${formatINR(-(d.balance ?? 0))}` : "Your account is fully settled."}${sign}`,
        params: [d.name, formatINR(d.amount ?? 0), formatINR(d.balance ?? 0)],
      };
    case "STATEMENT":
      return { text: `Hello ${d.name},\n\nPlease find your account statement with ${d.business}. Current balance: ${formatINR(d.balance ?? 0)}.${sign}`, params: [d.name, formatINR(d.balance ?? 0)] };
    case "INVOICE":
      return { text: `Hello ${d.name},\n\nThank you for your purchase. Invoice ${d.docNo} for ${formatINR(d.amount ?? 0)} is attached.${(d.balance ?? 0) > 0 ? `\nBalance due: ${formatINR(d.balance ?? 0)}` : ""}${sign}`, params: [d.name, d.docNo ?? "", formatINR(d.amount ?? 0)] };
    case "RECEIPT":
      return { text: `Hello ${d.name},\n\nReceipt ${d.docNo} for your payment of ${formatINR(d.amount ?? 0)} is attached. Thank you!${sign}`, params: [d.name, formatINR(d.amount ?? 0)] };
    case "MONTHLY_SUMMARY":
      return { text: `Hello ${d.name},\n\nYour account summary for ${d.month}: closing balance ${formatINR(d.balance ?? 0)}.${(d.balance ?? 0) > 0 ? "\nKindly arrange the payment at your convenience." : ""}${sign}`, params: [d.name, d.month ?? "", formatINR(d.balance ?? 0)] };
  }
}

export function waLink(phone: string, text: string) {
  const n = normalizePhone(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- logging
async function log(db: Executor, actor: Actor, v: { mode: "CLOUD_API" | "MANUAL"; type: MessageType; to: string; party?: { type: "CUSTOMER" | "SUPPLIER"; id: string } | null; body: string; template?: string | null; documentRef?: string | null; status: (typeof s.messageStatusEnum.enumValues)[number]; providerMessageId?: string | null; error?: string | null }) {
  const [row] = await db
    .insert(s.messageLogs)
    .values({
      mode: v.mode,
      messageType: v.type,
      toNumber: v.to,
      partyType: v.party?.type ?? null,
      partyId: v.party?.id ?? null,
      templateName: v.template ?? null,
      body: v.body,
      documentRef: v.documentRef ?? null,
      providerMessageId: v.providerMessageId ?? null,
      status: v.status,
      statusHistory: [{ status: v.status, at: new Date().toISOString(), detail: v.error ?? undefined }],
      error: v.error ?? null,
      createdBy: actor.id,
    })
    .returning();
  return row;
}

export async function logManualShare(db: DB, actor: Actor, v: { type: MessageType; to: string; party?: { type: "CUSTOMER" | "SUPPLIER"; id: string } | null; body: string; documentRef?: string | null }) {
  assertCan(actor, "messages.send");
  return log(db, actor, { ...v, mode: "MANUAL", status: "MANUAL_OPENED" });
}

// ---------------------------------------------------------------- cloud API
async function uploadMedia(pdf: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  const res = await fetch(graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`), { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, body: form });
  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? `Media upload failed (${res.status})`);
  return json.id;
}

/** Sends via Cloud API. Returns the log row; status SENT only when Meta accepted it. */
export async function sendCloud(
  db: DB,
  actor: Actor,
  v: { type: MessageType; to: string; party?: { type: "CUSTOMER" | "SUPPLIER"; id: string } | null; text: string; params: string[]; pdf?: { buffer: Buffer; filename: string; ref: string } | null },
) {
  assertCan(actor, "messages.send");
  if (!cloudConfigured()) throw new AppError("WhatsApp Cloud API is not configured. Use manual sharing, or add the API credentials to the server environment.");
  const settings = await getSettingsRow(db);
  const to = normalizePhone(v.to);
  if (!to) throw new AppError("This contact has no valid WhatsApp number.");
  const tpl = settings.whatsappTemplates?.[v.type];
  let payload: Record<string, unknown>;
  try {
    let mediaId: string | null = null;
    if (v.pdf) mediaId = await uploadMedia(v.pdf.buffer, v.pdf.filename);
    if (tpl?.name) {
      const components: Record<string, unknown>[] = [];
      if (mediaId) components.push({ type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: v.pdf!.filename } }] });
      components.push({ type: "body", parameters: v.params.map((p) => ({ type: "text", text: p })) });
      payload = { messaging_product: "whatsapp", to, type: "template", template: { name: tpl.name, language: { code: tpl.language || "en" }, components } };
    } else if (mediaId) {
      payload = { messaging_product: "whatsapp", to, type: "document", document: { id: mediaId, filename: v.pdf!.filename, caption: v.text.slice(0, 1000) } };
    } else {
      payload = { messaging_product: "whatsapp", to, type: "text", text: { body: v.text, preview_url: false } };
    }
    const res = await fetch(graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string; code?: number } };
    if (!res.ok || !json.messages?.[0]?.id) {
      const msg = json.error?.message ?? `HTTP ${res.status}`;
      const hint = !tpl?.name && json.error?.code === 131047 ? " (outside the 24-hour window: configure an approved template in Settings → WhatsApp)" : "";
      const row = await log(db, actor, { mode: "CLOUD_API", type: v.type, to, party: v.party, body: v.text, template: tpl?.name, documentRef: v.pdf?.ref, status: "FAILED", error: msg + hint });
      return { ok: false as const, error: msg + hint, log: row };
    }
    const row = await log(db, actor, { mode: "CLOUD_API", type: v.type, to, party: v.party, body: v.text, template: tpl?.name, documentRef: v.pdf?.ref, status: "SENT", providerMessageId: json.messages[0].id });
    return { ok: true as const, log: row };
  } catch (e) {
    const msg = (e as Error).message;
    const row = await log(db, actor, { mode: "CLOUD_API", type: v.type, to, party: v.party, body: v.text, template: tpl?.name, documentRef: v.pdf?.ref, status: "FAILED", error: msg });
    return { ok: false as const, error: msg, log: row };
  }
}

// ---------------------------------------------------------------- webhook
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

export async function applyStatusUpdates(db: DB, body: unknown) {
  type Status = { id: string; status: string; timestamp?: string; errors?: { title?: string; message?: string }[] };
  const entries = (body as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] })?.entry ?? [];
  let updated = 0;
  for (const e of entries)
    for (const c of e.changes ?? [])
      for (const st of c.value?.statuses ?? []) {
        const status = st.status.toUpperCase();
        if (!(status in RANK)) continue;
        const [row] = await db.select().from(s.messageLogs).where(eq(s.messageLogs.providerMessageId, st.id));
        if (!row) continue;
        const at = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString();
        const detail = st.errors?.map((x) => x.message ?? x.title).join("; ");
        const history = [...(row.statusHistory ?? []), { status, at, detail }];
        // never downgrade (READ must not go back to DELIVERED); FAILED always wins
        const next = status === "FAILED" || RANK[status] > (RANK[row.status] ?? 0) ? status : row.status;
        await db
          .update(s.messageLogs)
          .set({ status: next as never, statusHistory: history, error: status === "FAILED" ? detail ?? "Delivery failed" : row.error, updatedAt: new Date() })
          .where(eq(s.messageLogs.id, row.id));
        updated++;
      }
  return updated;
}

export async function listMessages(db: Executor, actor: Actor, f: { partyType?: "CUSTOMER" | "SUPPLIER"; partyId?: string; limit?: number } = {}) {
  assertCan(actor, "messages.send");
  const rows = await db
    .select({ m: s.messageLogs, by: s.users.name, partyName: sql<string | null>`coalesce(${s.customers.name}, ${s.suppliers.name})` })
    .from(s.messageLogs)
    .leftJoin(s.users, eq(s.users.id, s.messageLogs.createdBy))
    .leftJoin(s.customers, and(eq(s.messageLogs.partyType, "CUSTOMER"), eq(s.customers.id, s.messageLogs.partyId)))
    .leftJoin(s.suppliers, and(eq(s.messageLogs.partyType, "SUPPLIER"), eq(s.suppliers.id, s.messageLogs.partyId)))
    .where(and(f.partyType ? eq(s.messageLogs.partyType, f.partyType) : undefined, f.partyId ? eq(s.messageLogs.partyId, f.partyId) : undefined))
    .orderBy(desc(s.messageLogs.createdAt))
    .limit(f.limit ?? 100);
  return rows.map((r) => ({ ...r.m, by: r.by, partyName: r.partyName }));
}
