import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getDb } from "@/server/db";
import { reportDocument } from "@/server/documents";
import { reportPdf } from "@/server/pdf";
import { pdfResponse, withActor } from "@/server/http";
import { REPORTS, defaultReportRange, type Report, type ReportKey } from "@/server/services/reports";
import { resolveRange } from "@/lib/dates";
import { fromMilli, fromPaise } from "@/lib/money";

function plain(v: string | number | null | undefined, kind: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (kind === "money") return fromPaise(v);
  if (kind === "qty") return fromMilli(v);
  return String(v);
}

function toCsv(r: Report): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(plain(row[c.key], c.kind))).join(","));
  if (r.totals) lines.push(r.columns.map((c) => esc(plain(r.totals![c.key], c.kind))).join(","));
  return "﻿" + lines.join("\r\n");
}

async function toXlsx(r: Report, business: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = business;
  const ws = wb.addWorksheet(r.title.slice(0, 30).replace(/[\\/*?:[\]]/g, "-"));
  ws.addRow([business]).font = { bold: true, size: 14 };
  ws.addRow([r.title, r.subtitle]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F1" } };
  });
  const add = (row: Record<string, string | number | null>, bold = false) => {
    const xr = ws.addRow(
      r.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined || v === "") return null;
        if (typeof v === "string") return v;
        // Spreadsheet cells are doubles; amounts with 2 decimals are represented exactly enough for display/sums in Excel.
        if (c.kind === "money") return Number(fromPaise(v));
        if (c.kind === "qty") return Number(fromMilli(v));
        return v;
      }),
    );
    if (bold) xr.font = { bold: true };
  };
  r.rows.forEach((row) => add(row, !!row.bold));
  if (r.totals) add(r.totals, true);
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.kind === "text" ? 26 : 16;
    if (c.kind === "money") col.numFmt = "[$₹-4009] #,##,##0.00;[Red]-[$₹-4009] #,##,##0.00";
    if (c.kind === "qty") col.numFmt = "#,##0.###";
  });
  if (r.note) {
    ws.addRow([]);
    ws.addRow([r.note]).font = { italic: true, color: { argb: "FF64748B" } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const def = REPORTS.find((r) => r.key === key);
  if (!def) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const range = sp.get("range") ? resolveRange({ range: sp.get("range"), from: sp.get("from"), to: sp.get("to") }) : defaultReportRange(key as ReportKey);
  const format = sp.get("format") ?? "pdf";
  return withActor(async (actor) => {
    const { report, settings } = await reportDocument(await getDb(), actor, key as ReportKey, range, { partyId: sp.get("party") ?? undefined, q: sp.get("q") ?? undefined });
    const base = `${report.key}-${range.from}-to-${range.to}`;
    if (format === "csv") return new Response(toCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
    if (format === "xlsx")
      return new Response(new Uint8Array(await toXlsx(report, settings.businessName)), {
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"` },
      });
    const pdf = await reportPdf(settings, report, { generatedBy: actor.name });
    return pdfResponse(pdf, `${base}.pdf`, sp.has("download"));
  });
}
