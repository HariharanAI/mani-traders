import { getDb } from "@/server/db";
import { receiptDocument } from "@/server/documents";
import { pdfResponse, withActor } from "@/server/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withActor(async (actor) => {
    const d = await receiptDocument(await getDb(), actor, id);
    return pdfResponse(d.buffer, d.filename, new URL(req.url).searchParams.has("download"));
  });
}
