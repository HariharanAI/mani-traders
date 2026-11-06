/**
 * Invoice / bill calculator. Pure and deterministic; used for the live preview
 * in the browser AND (authoritatively) on the server when saving. All maths in
 * integer paise.
 *
 * Tax modes:
 *  NONE      — not GST registered or composition scheme: bill of supply, no tax.
 *  EXCLUSIVE — rates are before tax; GST added on top of the taxable value.
 *  INCLUSIVE — rates include GST; taxable value is back-calculated.
 * Intra-state supply splits GST equally into CGST + SGST; inter-state uses IGST.
 */
import { divRound, lineAmount, toMilli, toPaise, toRateHundredths, type Paise } from "./money";

export type TaxMode = "NONE" | "EXCLUSIVE" | "INCLUSIVE";

export type LineInput = {
  quantity: string;
  rate: string;
  discount?: string; // flat amount off this line
  gstRate?: string; // percent, e.g. "18"
};

export type LineResult = {
  qtyMilli: number;
  rate: Paise;
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  gstRate: number; // hundredths of a percent
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  tax: Paise;
  total: Paise;
};

export type BillResult = {
  lines: LineResult[];
  subtotal: Paise;
  discountTotal: Paise;
  taxableTotal: Paise;
  cgstTotal: Paise;
  sgstTotal: Paise;
  igstTotal: Paise;
  taxTotal: Paise;
  roundOff: Paise;
  grandTotal: Paise;
  taxBreakup: { gstRate: number; taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise }[];
};

export const GST_RATES = ["0", "0.25", "3", "5", "12", "18", "28", "40"];

export function computeLine(input: LineInput, mode: TaxMode, interstate: boolean): LineResult {
  const qtyMilli = toMilli(input.quantity);
  const rate = toPaise(input.rate);
  const discount = toPaise(input.discount || "0");
  const gstRate = mode === "NONE" ? 0 : toRateHundredths(input.gstRate || "0");
  if (qtyMilli <= 0) throw new Error("Quantity must be greater than zero");
  if (rate < 0) throw new Error("Rate cannot be negative");
  if (discount < 0) throw new Error("Discount cannot be negative");
  if (gstRate < 0 || gstRate > 10000) throw new Error("Invalid GST rate");
  const gross = lineAmount(qtyMilli, rate);
  if (discount > gross) throw new Error("Discount cannot exceed the line amount");
  const net = gross - discount;

  let taxable = net;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (mode === "EXCLUSIVE" && gstRate > 0) {
    if (interstate) igst = divRound(BigInt(taxable) * BigInt(gstRate), 10000n);
    else {
      cgst = divRound(BigInt(taxable) * BigInt(gstRate), 20000n);
      sgst = cgst;
    }
  } else if (mode === "INCLUSIVE" && gstRate > 0) {
    taxable = divRound(BigInt(net) * 10000n, BigInt(10000 + gstRate));
    const tax = net - taxable;
    if (interstate) igst = tax;
    else {
      cgst = divRound(BigInt(tax), 2n);
      sgst = tax - cgst;
    }
  }
  const tax = cgst + sgst + igst;
  return { qtyMilli, rate, gross, discount, taxable, gstRate, cgst, sgst, igst, tax, total: taxable + tax };
}

export function computeBill(lines: LineInput[], mode: TaxMode, interstate: boolean, roundToRupee = true): BillResult {
  const results = lines.map((l) => computeLine(l, mode, interstate));
  const s = (f: (l: LineResult) => number) => results.reduce((a, l) => a + f(l), 0);
  const taxableTotal = s((l) => l.taxable);
  const cgstTotal = s((l) => l.cgst);
  const sgstTotal = s((l) => l.sgst);
  const igstTotal = s((l) => l.igst);
  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const beforeRound = taxableTotal + taxTotal;
  const rounded = roundToRupee ? divRound(BigInt(beforeRound), 100n) * 100 : beforeRound;
  const breakup = new Map<number, { gstRate: number; taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise }>();
  for (const l of results) {
    const b = breakup.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    b.taxable += l.taxable;
    b.cgst += l.cgst;
    b.sgst += l.sgst;
    b.igst += l.igst;
    breakup.set(l.gstRate, b);
  }
  return {
    lines: results,
    subtotal: s((l) => l.gross),
    discountTotal: s((l) => l.discount),
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    taxTotal,
    roundOff: rounded - beforeRound,
    grandTotal: rounded,
    taxBreakup: [...breakup.values()].sort((a, b) => a.gstRate - b.gstRate),
  };
}

/** GSTIN format check (15 chars: 2-digit state, PAN, entity, Z, checksum). */
export function isValidGSTIN(g: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g.toUpperCase());
}

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" }, { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" }, { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" }, { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" }, { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" }, { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" }, { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" }, { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar Islands" }, { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" }, { code: "97", name: "Other Territory" },
];
export const stateName = (code?: string | null) => INDIAN_STATES.find((s) => s.code === code)?.name ?? null;
