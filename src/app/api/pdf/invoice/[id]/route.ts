import { getDb } from "@/server/db";
import { invoiceDocument } from "@/server/documents";
import { pdfResponse, withActor } from "@/server/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const d = await invoiceDocument(await getDb(), actor, id);
    return pdfResponse(d.buffer, d.filename, new URL(req.url).searchParams.has("download"));
  });
}
