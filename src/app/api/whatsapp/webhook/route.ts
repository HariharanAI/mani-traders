import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { applyStatusUpdates, verifySignature } from "@/server/services/whatsapp";

/** Meta webhook verification handshake. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (expected && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === expected) {
    return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Delivery status updates. Rejected unless signed with the app secret. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 401 });
  try {
    const n = await applyStatusUpdates(await getDb(), JSON.parse(raw));
    return NextResponse.json({ ok: true, updated: n });
  } catch (e) {
    console.error("[whatsapp webhook]", e);
    return NextResponse.json({ ok: false }, { status: 200 }); // avoid Meta retry storms on malformed payloads
  }
}
