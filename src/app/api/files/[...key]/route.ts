import { NextResponse } from "next/server";
import { getFile } from "@/server/storage";
import { withActor } from "@/server/http";

/** Authenticated file access (attachments, receipts, product images, logo). */
export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  return withActor(async () => {
    const file = await getFile(key.join("/"));
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  });
}
