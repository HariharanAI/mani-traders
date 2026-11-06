import { getDb } from "@/server/db";
import { statementDocument } from "@/server/documents";
import { pdfResponse, withActor } from "@/server/http";
import { isISODate, todayIST } from "@/lib/dates";

export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") && isISODate(sp.get("from")!) ? sp.get("from")! : "2000-01-01";
  const to = sp.get("to") && isISODate(sp.get("to")!) ? sp.get("to")! : todayIST();
  return withActor(async (actor) => {
    const d = await statementDocument(await getDb(), actor, type === "supplier" ? "SUPPLIER" : "CUSTOMER", id, { from, to });
    return pdfResponse(d.buffer, d.filename, sp.has("download"));
  });
}
