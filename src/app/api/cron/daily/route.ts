import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { runDailyJobs } from "@/server/services/jobs";

/**
 * Call daily (e.g. 06:00 IST) with header `Authorization: Bearer $CRON_SECRET`.
 * Vercel Cron sends this header automatically (GET) when CRON_SECRET is set.
 */
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return POST(req);
}
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.has("force");
  return NextResponse.json(await runDailyJobs(await getDb(), { force }));
}
