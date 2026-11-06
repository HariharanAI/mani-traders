import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { globalSearch } from "@/server/services/search";
import { withActor } from "@/server/http";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return withActor(async (actor) => NextResponse.json({ hits: await globalSearch(await getDb(), actor, q.slice(0, 80)) }));
}
