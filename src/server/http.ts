import "server-only";
import { NextResponse } from "next/server";
import { getActor } from "./auth/session";
import { AppError } from "./core";

export async function withActor(fn: (actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) => Promise<Response>) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    return await fn(actor);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[route]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export function pdfResponse(buffer: Buffer, filename: string, download: boolean) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
