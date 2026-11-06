/**
 * PDF documents: invoices, payment receipts, party statements and reports.
 * Uses Noto Sans (bundled in ./assets/fonts) so the ₹ sign renders correctly.
 */
import path from "node:path";
import fs from "node:fs";
import PDFDocument from "pdfkit";
import { amountInWords, formatINR, formatQty, toMilli, toPaise } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { stateName } from "@/lib/gst";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import type { Report } from "./services/reports";
import { getFile } from "./storage";

type Settings = Awaited<ReturnType<typeof import("./core").getSettingsRow>>;
type Doc = PDFKit.PDFDocument;

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const ACCENT = "#0f766e";
const SOFT = "#f1f5f9";

function fontPath(name: string) {
  const candidates = [path.join(process.cwd(), "assets", "fonts", name), path.join(__dirname, "../../assets/fonts", name)];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

function newDoc(opts: { landscape?: boolean; title: string }) {
  const doc = new PDFDocument({ size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: 36, bufferPages: true, info: { Title: opts.title, Producer: "MANI TRADERS" } });
  doc.registerFont("R", fontPath("NotoSans_400Regular.ttf"));
  doc.registerFont("M", fontPath("NotoSans_600SemiBold.ttf"));
  doc.registerFont("B", fontPath("NotoSans_700Bold.ttf"));
  doc.font("R").fillColor(INK);
  return doc;
}

function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function footer(doc: Doc, settings: Settings, label: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would trigger an automatic page break.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 28;
    doc.font("R").fontSize(7).fillColor(MUTED);
    doc.text(`${settings.businessName} · ${label}`, 36, y, { width: 300, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - 136, y, { width: 100, align: "right", lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

async function header(doc: Doc, settings: Settings, title: string, right: [string, string][]) {
  const left = 36;
  const width = doc.page.width - 72;
  let x = left;
  if (settings.logoKey) {
    const logo = await getFile(settings.logoKey);
    if (logo && (logo.contentType === "image/png" || logo.contentType === "image/jpeg")) {
      try {
        doc.image(logo.body, left, 36, { fit: [48, 48] });
        x = left + 58;
      } catch {
        /* ignore bad image */
      }
    }
  }
  doc.font("B").fontSize(18).fillColor(INK).text(settings.businessName, x, 34, { width: width / 2 });
  doc.font("R").fontSize(8).fillColor(MUTED);
  const addr = [settings.addressLine1, settings.addressLine2, [settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n");
  if (settings.tagline) doc.text(settings.tagline, x, doc.y, { width: width / 2 });
  if (addr) doc.text(addr, x, doc.y, { width: width / 2 });
  const contact = [settings.phone ? `Ph: ${settings.phone}` : null, settings.email].filter(Boolean).join(" · ");
  if (contact) doc.text(contact, x, doc.y, { width: width / 2 });
  if (settings.gstRegistered && settings.gstin) doc.font("M").fillColor(INK).text(`GSTIN: ${settings.gstin}`, x, doc.y, { width: width / 2 });
  const leftBottom = doc.y;

  doc.font("B").fontSize(13).fillColor(ACCENT).text(title, left + width / 2, 34, { width: width / 2, align: "right" });
  doc.moveDown(0.2);
  for (const [k, v] of right) {
    const y = doc.y;
    doc.font("R").fontSize(8).fillColor(MUTED).text(k, left + width / 2, y, { width: width / 2 - 110, align: "right" });
    doc.font("M").fontSize(8.5).fillColor(INK).text(v, left + width - 105, y, { width: 105, align: "right" });
  }
  const y = Math.max(leftBottom, doc.y) + 10;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(LINE).stroke();
  doc.y = y + 10;
}

type Col = { label: string; width: number; align?: "left" | "right" | "center" };
function table(doc: Doc, cols: Col[], rows: string[][], opts: { bold?: (i: number) => boolean; zebra?: boolean; fontSize?: number } = {}) {
  const left = 36;
  const fs2 = opts.fontSize ?? 8;
  const total = cols.reduce((a, c) => a + c.width, 0);
  const drawHead = () => {
    const y = doc.y;
    doc.rect(left, y, total, 18).fill(SOFT);
    let x = left;
    doc.font("M").fontSize(fs2).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 5, { width: c.width - 8, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += c.width;
    }
    doc.y = y + 18;
  };
  drawHead();
  rows.forEach((r, i) => {
    doc.font(opts.bold?.(i) ? "M" : "R").fontSize(fs2);
    const h = Math.max(16, ...r.map((cell, j) => doc.heightOfString(cell || " ", { width: cols[j].width - 8 }) + 7));
    if (doc.y + h > doc.page.height - 50) {
      doc.addPage();
      doc.y = 40;
      drawHead();
      doc.font(opts.bold?.(i) ? "M" : "R").fontSize(fs2);
    }
    const y = doc.y;
    if (opts.zebra && i % 2 === 1) doc.rect(left, y, total, h).fill("#fafafa");
    let x = left;
    doc.fillColor(INK);
    r.forEach((cell, j) => {
      doc.text(cell ?? "", x + 4, y + 4, { width: cols[j].width - 8, align: cols[j].align ?? "left" });
      x += cols[j].width;
    });
    doc.moveTo(left, y + h).lineTo(left + total, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  });
}

function kv(doc: Doc, x: number, width: number, rows: [string, string, boolean?][]) {
  for (const [k, v, strong] of rows) {
    const y = doc.y;
    doc.font(strong ? "B" : "R").fontSize(strong ? 10 : 8.5).fillColor(strong ? INK : MUTED).text(k, x, y, { width: width - 110 });
    doc.font(strong ? "B" : "M").fillColor(INK).text(v, x + width - 110, y, { width: 110, align: "right" });
    doc.y = Math.max(doc.y, y + (strong ? 16 : 13));
  }
}

function watermark(doc: Doc, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("B").fontSize(80).fillColor("#dc2626").opacity(0.12).text(text, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center" });
    doc.restore();
    doc.opacity(1);
  }
}

// ================================================================== invoice
type SaleFull = Awaited<ReturnType<typeof import("./services/sales").getSale>>;

export async function invoicePdf(settings: Settings, sale: SaleFull): Promise<Buffer> {
  const isTax = sale.taxMode !== "NONE";
  const title = isTax ? "TAX INVOICE" : "BILL OF SUPPLY";
  const doc = newDoc({ title: `${title} ${sale.invoiceNo}` });
  await header(doc, settings, title, [
    ["Invoice no.", sale.invoiceNo],
    ["Invoice date", formatDate(sale.saleDate)],
    ...(isTax ? ([["Place of supply", `${stateName(sale.placeOfSupply) ?? "—"}${sale.placeOfSupply ? ` (${sale.placeOfSupply})` : ""}`]] as [string, string][]) : []),
  ]);
  const left = 36;
  const width = doc.page.width - 72;
  const top = doc.y;
  doc.font("M").fontSize(8).fillColor(MUTED).text("BILL TO", left, top);
  doc.font("B").fontSize(11).fillColor(INK).text(sale.customerName, left, doc.y, { width: width / 2 });
  doc.font("R").fontSize(8.5).fillColor(INK);
  if (sale.customerAddress) doc.text(sale.customerAddress, { width: width / 2 });
  if (sale.customerMobile) doc.text(`Mobile: ${sale.customerMobile}`, { width: width / 2 });
  if (sale.customerGstin) doc.font("M").text(`GSTIN: ${sale.customerGstin}`, { width: width / 2 });
  doc.y += 10;

  const inter = sale.isInterstate;
  const cols: Col[] = isTax
    ? [
        { label: "#", width: 20 },
        { label: "Item", width: 150 },
        { label: "HSN", width: 42 },
        { label: "Qty", width: 46, align: "right" },
        { label: "Rate", width: 60, align: "right" },
        { label: "Disc.", width: 45, align: "right" },
        { label: "Taxable", width: 62, align: "right" },
        { label: "GST", width: 32, align: "right" },
        { label: "Amount", width: width - 457, align: "right" },
      ]
    : [
        { label: "#", width: 24 },
        { label: "Item", width: 220 },
        { label: "Qty", width: 60, align: "right" },
        { label: "Rate", width: 75, align: "right" },
        { label: "Disc.", width: 60, align: "right" },
        { label: "Amount", width: width - 439, align: "right" },
      ];
  const rows = sale.items.map((it, i) => {
    const q = `${formatQty(toMilli(it.quantity))} ${it.unit}`;
    return isTax
      ? [String(i + 1), it.description, it.hsnCode ?? "", q, formatINR(toPaise(it.rate), { symbol: false }), toPaise(it.discount) ? formatINR(toPaise(it.discount), { symbol: false }) : "", formatINR(toPaise(it.taxable), { symbol: false }), `${Number(it.gstRate)}%`, formatINR(toPaise(it.total), { symbol: false })]
      : [String(i + 1), it.description, q, formatINR(toPaise(it.rate), { symbol: false }), toPaise(it.discount) ? formatINR(toPaise(it.discount), { symbol: false }) : "", formatINR(toPaise(it.total), { symbol: false })];
  });
  table(doc, cols, rows, { zebra: true });
  doc.y += 10;

  if (doc.y > doc.page.height - 260) {
    doc.addPage();
    doc.y = 40;
  }
  const blockTop = doc.y;
  const rightX = left + width / 2 + 20;
  const rightW = width / 2 - 20;
  const totals: [string, string, boolean?][] = [["Subtotal", formatINR(toPaise(sale.subtotal))]];
  if (toPaise(sale.discountTotal)) totals.push(["Discount", `-${formatINR(toPaise(sale.discountTotal))}`]);
  if (isTax) {
    totals.push(["Taxable value", formatINR(toPaise(sale.taxableTotal))]);
    if (inter) totals.push(["IGST", formatINR(toPaise(sale.igstTotal))]);
    else {
      totals.push(["CGST", formatINR(toPaise(sale.cgstTotal))]);
      totals.push(["SGST", formatINR(toPaise(sale.sgstTotal))]);
    }
  }
  if (toPaise(sale.roundOff)) totals.push(["Round off", formatINR(toPaise(sale.roundOff), { sign: true })]);
  totals.push(["Grand total", formatINR(sale.grand), true]);
  if (sale.returned) totals.push(["Returns (credit notes)", `-${formatINR(sale.returned)}`]);
  totals.push(["Amount paid", formatINR(sale.paid)]);
  totals.push(["Balance due", formatINR(sale.due), true]);
  doc.y = blockTop;
  kv(doc, rightX, rightW, totals);
  const rightBottom = doc.y;

  doc.y = blockTop;
  doc.font("M").fontSize(8).fillColor(MUTED).text("AMOUNT IN WORDS", left, doc.y);
  doc.font("R").fontSize(8.5).fillColor(INK).text(amountInWords(sale.grand), left, doc.y, { width: width / 2 });
  doc.y += 8;
  if (isTax) {
    // GST breakup by rate
    const byRate = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const it of sale.items) {
      const k = String(Number(it.gstRate));
      const b = byRate.get(k) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      b.taxable += toPaise(it.taxable);
      b.cgst += toPaise(it.cgst);
      b.sgst += toPaise(it.sgst);
      b.igst += toPaise(it.igst);
      byRate.set(k, b);
    }
    const w = width / 2;
    const gcols: Col[] = inter
      ? [{ label: "GST %", width: w * 0.2 }, { label: "Taxable", width: w * 0.4, align: "right" }, { label: "IGST", width: w * 0.4, align: "right" }]
      : [{ label: "GST %", width: w * 0.16 }, { label: "Taxable", width: w * 0.32, align: "right" }, { label: "CGST", width: w * 0.26, align: "right" }, { label: "SGST", width: w * 0.26, align: "right" }];
    const grows = [...byRate.entries()].map(([r, b]) => (inter ? [`${r}%`, formatINR(b.taxable, { symbol: false }), formatINR(b.igst, { symbol: false })] : [`${r}%`, formatINR(b.taxable, { symbol: false }), formatINR(b.cgst, { symbol: false }), formatINR(b.sgst, { symbol: false })]));
    table(doc, gcols, grows, { fontSize: 7.5 });
    doc.y += 6;
  }
  if (sale.payments.length) {
    doc.font("M").fontSize(8).fillColor(MUTED).text("PAYMENTS", left, doc.y);
    for (const p of sale.payments.filter((x) => x.direction === "IN")) {
      doc.font("R").fontSize(8).fillColor(p.status === "ACTIVE" ? INK : MUTED).text(`${formatDate(p.paymentDate)} · ${PAYMENT_METHOD_LABEL[p.method as PaymentMethod]}${p.referenceNo ? ` (${p.referenceNo})` : ""} · ${formatINR(toPaise(p.amount))}${p.status !== "ACTIVE" ? " — reversed" : ""}`, left, doc.y, { width: width / 2 });
    }
    doc.y += 6;
  }
  if (settings.bankDetails || settings.upiId) {
    doc.font("M").fontSize(8).fillColor(MUTED).text("PAYMENT DETAILS", left, doc.y);
    doc.font("R").fontSize(8).fillColor(INK);
    if (settings.bankDetails) doc.text(settings.bankDetails, left, doc.y, { width: width / 2 });
    if (settings.upiId) doc.text(`UPI: ${settings.upiId}`, left, doc.y, { width: width / 2 });
  }
  doc.y = Math.max(doc.y, rightBottom) + 16;
  if (settings.invoiceTerms) {
    doc.font("M").fontSize(8).fillColor(MUTED).text("TERMS & CONDITIONS", left, doc.y);
    doc.font("R").fontSize(7.5).fillColor(INK).text(settings.invoiceTerms, left, doc.y, { width: width * 0.6 });
  }
  const signY = Math.max(doc.y + 20, doc.y);
  doc.font("M").fontSize(8.5).fillColor(INK).text(`For ${settings.businessName}`, left + width - 200, signY, { width: 200, align: "right" });
  doc.font("R").fontSize(7.5).fillColor(MUTED).text("Authorised signatory", left + width - 200, signY + 30, { width: 200, align: "right" });
  if (settings.invoiceFooter) doc.font("R").fontSize(8).fillColor(MUTED).text(settings.invoiceFooter, left, signY + 50, { width, align: "center" });
  if (sale.status === "CANCELLED") watermark(doc, "CANCELLED");
  footer(doc, settings, `${title} ${sale.invoiceNo}`);
  return toBuffer(doc);
}

// ================================================================== receipt
type PaymentFull = Awaited<ReturnType<typeof import("./services/payments").getPayment>>;

export async function receiptPdf(settings: Settings, p: PaymentFull): Promise<Buffer> {
  const isIn = p.direction === "IN";
  const title = isIn ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER";
  const doc = newDoc({ title: `${title} ${p.paymentNo}` });
  await header(doc, settings, title, [
    [isIn ? "Receipt no." : "Voucher no.", p.paymentNo],
    ["Date", formatDate(p.paymentDate)],
  ]);
  const left = 36;
  const width = doc.page.width - 72;
  doc.font("R").fontSize(10).fillColor(INK);
  doc.text(isIn ? "Received with thanks from" : "Paid to", left, doc.y);
  doc.font("B").fontSize(14).text(p.party?.name ?? "Walk-in customer");
  if (p.party && "mobile" in p.party && p.party.mobile) doc.font("R").fontSize(9).fillColor(MUTED).text(`Mobile: ${p.party.mobile}`);
  doc.y += 14;
  const boxY = doc.y;
  doc.roundedRect(left, boxY, width, 70, 6).fill(SOFT);
  doc.font("R").fontSize(9).fillColor(MUTED).text("Amount", left + 16, boxY + 12);
  doc.font("B").fontSize(24).fillColor(p.status === "ACTIVE" ? ACCENT : MUTED).text(formatINR(p.amountP), left + 16, boxY + 26);
  doc.font("R").fontSize(8.5).fillColor(INK).text(amountInWords(p.amountP), left + width / 2, boxY + 16, { width: width / 2 - 16, align: "right" });
  doc.y = boxY + 86;
  const rows: [string, string, boolean?][] = [
    ["Payment method", PAYMENT_METHOD_LABEL[p.method as PaymentMethod]],
    ["Reference", p.referenceNo ?? "—"],
  ];
  if (p.sale) rows.push(["Against invoice", p.sale.invoiceNo]);
  if (p.purchase) rows.push(["Against purchase", p.purchase.purchaseNo]);
  if (p.notes) rows.push(["Notes", p.notes]);
  if (p.balanceAfter !== null && p.partyType) {
    const bal = toPaise(p.balanceAfter);
    const label = p.partyType === "CUSTOMER" ? (bal >= 0 ? "Outstanding after this payment" : "Advance with us after this payment") : bal >= 0 ? "Payable after this payment" : "Advance after this payment";
    rows.push([label, formatINR(Math.abs(bal)), true]);
  }
  kv(doc, left, width, rows);
  doc.y += 30;
  doc.font("R").fontSize(7.5).fillColor(MUTED).text(`Recorded by ${p.createdByName ?? "—"} on ${formatDateTime(p.createdAt)}. This is a computer-generated ${isIn ? "receipt" : "voucher"}.`, left, doc.y, { width });
  doc.font("M").fontSize(8.5).fillColor(INK).text(`For ${settings.businessName}`, left + width - 200, doc.y + 20, { width: 200, align: "right" });
  if (p.status !== "ACTIVE") watermark(doc, "REVERSED");
  footer(doc, settings, `${title} ${p.paymentNo}`);
  return toBuffer(doc);
}

// ================================================================== reports & statements
function cell(v: string | number | null | undefined, kind: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  switch (kind) {
    case "money":
      return formatINR(v, { symbol: false });
    case "qty":
      return formatQty(v);
    case "percent":
      return `${v}%`;
    default:
      return String(v);
  }
}

export async function reportPdf(settings: Settings, report: Report, meta: { generatedBy: string }): Promise<Buffer> {
  const landscape = report.columns.length > 6;
  const doc = newDoc({ landscape, title: report.title });
  await header(doc, settings, report.title.toUpperCase(), [
    ["Period", report.subtitle],
    ["Generated", formatDateTime(new Date())],
    ["By", meta.generatedBy],
  ]);
  const width = doc.page.width - 72;
  if (report.summary?.length) {
    const n = Math.min(report.summary.length, 4);
    const w = width / n;
    const y = doc.y;
    report.summary.slice(0, 8).forEach((sm, i) => {
      const x = 36 + (i % n) * w;
      const yy = y + Math.floor(i / n) * 40;
      doc.roundedRect(x + 2, yy, w - 4, 34, 4).fill(SOFT);
      doc.font("R").fontSize(7).fillColor(MUTED).text(sm.label, x + 10, yy + 5, { width: w - 20 });
      doc.font("B").fontSize(10.5).fillColor(INK).text(sm.kind === "money" ? formatINR(sm.value) : cell(sm.value, sm.kind), x + 10, yy + 16, { width: w - 20 });
    });
    doc.y = y + Math.ceil(Math.min(report.summary.length, 8) / n) * 40 + 6;
  }
  if (report.columns.length) {
    const weights = report.columns.map((c) => (c.kind === "text" ? (["description", "name", "product", "item", "party", "source", "reason"].includes(c.key) ? 2.4 : 1.2) : 1));
    const sumW = weights.reduce((a, b) => a + b, 0);
    const cols: Col[] = report.columns.map((c, i) => ({ label: c.label, width: (width * weights[i]) / sumW, align: c.kind === "text" || c.kind === "date" ? "left" : "right" }));
    const rows = report.rows.map((r) => report.columns.map((c) => cell(r[c.key], c.kind)));
    if (report.totals) rows.push(report.columns.map((c) => cell(report.totals![c.key], c.kind)));
    table(doc, cols, rows, { zebra: true, fontSize: report.columns.length > 8 ? 7 : 7.5, bold: (i) => (!!report.totals && i === rows.length - 1) || !!report.rows[i]?.bold });
  }
  if (!report.rows.length) doc.font("R").fontSize(9).fillColor(MUTED).text("No records for this period.", 36, doc.y + 10);
  if (report.note) doc.font("R").fontSize(7.5).fillColor(MUTED).text(report.note, 36, doc.y + 12, { width });
  footer(doc, settings, report.title);
  return toBuffer(doc);
}
