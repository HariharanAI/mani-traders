import { describe, expect, it } from "vitest";
import { amountInWords, formatINR, fromPaise, lineAmount, percentOf, toMilli, toPaise } from "@/lib/money";
import { computeBill, isValidGSTIN } from "@/lib/gst";
import { financialYear, resolveRange, todayIST } from "@/lib/dates";

describe("money", () => {
  it("parses decimals exactly without floats", () => {
    expect(toPaise("0.1")).toBe(10);
    expect(toPaise("0.29")).toBe(29);
    expect(toPaise("1,23,456.78")).toBe(12345678);
    expect(toPaise("10.005")).toBe(1001); // half-up on the third decimal
    expect(toPaise("-5.5")).toBe(-550);
    expect(fromPaise(12345678)).toBe("123456.78");
    expect(fromPaise(-5)).toBe("-0.05");
    expect(() => toPaise("12a")).toThrow();
  });
  it("formats in the Indian numbering system", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(100000000000)).toBe("₹1,00,00,00,000.00");
    expect(formatINR(-600000)).toBe("-₹6,000.00");
    expect(formatINR(99, { decimals: false })).toBe("₹1");
  });
  it("multiplies quantity × rate exactly", () => {
    expect(lineAmount(toMilli("1.5"), toPaise("33.33"))).toBe(5000); // 49.995 → 50.00
    expect(lineAmount(toMilli("3"), toPaise("0.1"))).toBe(30);
    expect(percentOf(10000, 1800)).toBe(1800);
  });
  it("writes amounts in words", () => {
    expect(amountInWords(600000)).toBe("Rupees Six Thousand Only");
    expect(amountInWords(12345650)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only");
  });
});

describe("GST bill", () => {
  it("adds CGST+SGST on exclusive prices (intra-state)", () => {
    const b = computeBill([{ quantity: "2", rate: "500", gstRate: "18" }], "EXCLUSIVE", false);
    expect(b.taxableTotal).toBe(100000);
    expect(b.cgstTotal).toBe(9000);
    expect(b.sgstTotal).toBe(9000);
    expect(b.grandTotal).toBe(118000);
  });
  it("uses IGST inter-state", () => {
    const b = computeBill([{ quantity: "1", rate: "1000", gstRate: "12" }], "EXCLUSIVE", true);
    expect(b.igstTotal).toBe(12000);
    expect(b.cgstTotal).toBe(0);
  });
  it("back-calculates inclusive prices and rounds to rupee", () => {
    const b = computeBill([{ quantity: "1", rate: "118", gstRate: "18" }], "INCLUSIVE", false);
    expect(b.taxableTotal).toBe(10000);
    expect(b.taxTotal).toBe(1800);
    expect(b.grandTotal).toBe(11800);
    const c = computeBill([{ quantity: "3", rate: "33.33", gstRate: "5" }], "EXCLUSIVE", false);
    expect(c.grandTotal % 100).toBe(0);
    expect(c.taxableTotal + c.taxTotal + c.roundOff).toBe(c.grandTotal);
  });
  it("applies line discounts before tax and ignores tax when not registered", () => {
    const b = computeBill([{ quantity: "1", rate: "1000", discount: "100", gstRate: "18" }], "NONE", false);
    expect(b.taxTotal).toBe(0);
    expect(b.grandTotal).toBe(90000);
  });
  it("validates GSTIN format", () => {
    expect(isValidGSTIN("33AAAAA0000A1Z5")).toBe(true);
    expect(isValidGSTIN("33AAAAA0000A1X5")).toBe(false);
  });
});

describe("dates (IST)", () => {
  it("rolls over at IST midnight, not UTC", () => {
    expect(todayIST(new Date("2026-11-06T18:29:00Z"))).toBe("2026-11-06");
    expect(todayIST(new Date("2026-11-06T18:31:00Z"))).toBe("2026-11-07");
  });
  it("computes financial year and ranges", () => {
    expect(financialYear("2026-03-31")).toBe("2025-26");
    expect(financialYear("2026-04-01")).toBe("2026-27");
    expect(resolveRange({ range: "prev_month" }, "30d", "2026-03-15")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange({ range: "7d" }, "30d", "2026-11-07")).toMatchObject({ from: "2026-11-01", to: "2026-11-07" });
  });
});
