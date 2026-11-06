/**
 * Exact money arithmetic. All amounts are handled as integer paise and
 * quantities as integer thousandths ("milli"). Database numeric strings are
 * parsed digit-by-digit, never through floating point.
 */
export type Paise = number;

function parseDecimal(input: string | number | null | undefined, scale: number): number {
  if (input === null || input === undefined || input === "") return 0;
  let str =
    typeof input === "number"
      ? input.toFixed(scale + 1)
      : String(input).trim().replace(/,/g, "").replace(/^₹\s*/, "");
  if (!/^[-+]?\d*(\.\d*)?$/.test(str) || str === "" || str === "." || str === "-" || str === "+") {
    throw new Error(`Invalid number: ${input}`);
  }
  let neg = false;
  if (str[0] === "-" || str[0] === "+") {
    neg = str[0] === "-";
    str = str.slice(1);
  }
  const [intPart = "0", fracRaw = ""] = str.split(".");
  const padded = fracRaw.padEnd(scale + 1, "0");
  const roundUp = Number(padded[scale]) >= 5; // round half away from zero
  const frac = padded.slice(0, scale);
  let value = Number(intPart || "0") * 10 ** scale + Number(frac || "0");
  if (roundUp) value += 1;
  if (!Number.isSafeInteger(value)) throw new Error(`Number out of range: ${input}`);
  return neg && value !== 0 ? -value : value;
}

export const toPaise = (v: string | number | null | undefined): Paise => parseDecimal(v, 2);
export const toMilli = (v: string | number | null | undefined): number => parseDecimal(v, 3);
/** "18" / "2.5" percent -> hundredths (1800 / 250) */
export const toRateHundredths = (v: string | number | null | undefined): number => parseDecimal(v, 2);

function formatScaled(v: number, scale: number): string {
  const neg = v < 0;
  const abs = Math.abs(v);
  const base = 10 ** scale;
  const int = Math.floor(abs / base);
  const frac = String(abs % base).padStart(scale, "0");
  return `${neg ? "-" : ""}${int}.${frac}`;
}
/** paise -> "1234.50" (DB / input format) */
export const fromPaise = (p: Paise): string => formatScaled(p, 2);
/** milli -> "1.500" */
export const fromMilli = (m: number): string => formatScaled(m, 3);

/** Integer division with round-half-away-from-zero, via BigInt (no overflow). */
export function divRound(numerator: bigint, denominator: bigint): number {
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return Number(neg ? -q : q);
}

/** quantity (milli) × rate (paise) -> paise */
export const lineAmount = (qtyMilli: number, ratePaise: Paise): Paise =>
  divRound(BigInt(qtyMilli) * BigInt(ratePaise), 1000n);

/** amount (paise) × rate (hundredths of a percent, 18% = 1800) -> paise */
export const percentOf = (amount: Paise, rateHundredths: number): Paise =>
  divRound(BigInt(amount) * BigInt(rateHundredths), 10000n);

/** Split proportionally: amount × part / whole, rounded. */
export const proportion = (amount: Paise, part: number, whole: number): Paise =>
  whole === 0 ? 0 : divRound(BigInt(amount) * BigInt(part), BigInt(whole));

export const sum = (xs: Paise[]): Paise => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- display (Indian numbering)
function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** 123456789 paise -> "₹12,34,567.89" */
export function formatINR(p: Paise, opts: { symbol?: boolean; decimals?: boolean; sign?: boolean } = {}): string {
  const { symbol = true, decimals = true, sign = false } = opts;
  const neg = p < 0;
  const abs = Math.abs(p);
  let int = Math.floor(abs / 100);
  const frac = abs % 100;
  let out: string;
  if (decimals) out = `${groupIndian(String(int))}.${String(frac).padStart(2, "0")}`;
  else {
    if (frac >= 50) int += 1;
    out = groupIndian(String(int));
  }
  const prefix = neg ? "-" : sign && p > 0 ? "+" : "";
  return `${prefix}${symbol ? "₹" : ""}${out}`;
}

/** Compact for charts: ₹1.2L, ₹3.4Cr */
export function formatINRCompact(p: Paise): string {
  const r = p / 100;
  const abs = Math.abs(r);
  const sign = r < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatQty(milli: number): string {
  const s = fromMilli(milli);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Amount in words, Indian system. */
export function amountInWords(p: Paise): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
  };
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7);
    n %= 1e7;
    const lakh = Math.floor(n / 1e5);
    n %= 1e5;
    const thousand = Math.floor(n / 1e3);
    n %= 1e3;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const abs = Math.abs(p);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
