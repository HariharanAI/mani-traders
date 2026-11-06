import { z } from "zod";
import { isISODate } from "./dates";
import { isValidGSTIN } from "./gst";
import { PAYMENT_METHODS, EXPENSE_CATEGORY_KEYS } from "./accounts";

const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const amountStr = (label = "Amount") =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), `${label}: enter a valid amount (max 2 decimals)`)
    .refine((v) => Number(v) > 0, `${label} must be greater than zero`);

export const amountOrZero = (label = "Amount") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/,/g, "") : "0"))
    .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), `${label}: enter a valid amount`);

export const signedAmountOrZero = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/,/g, "") : "0"))
  .refine((v) => /^-?\d{1,12}(\.\d{1,2})?$/.test(v), "Enter a valid amount");

export const qtyStr = z
  .string()
  .trim()
  .refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "Enter a valid quantity (max 3 decimals)")
  .refine((v) => Number(v) > 0, "Quantity must be greater than zero");

export const qtyOrZero = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || "0")
  .refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "Enter a valid quantity");

export const dateStr = z.string().trim().refine(isISODate, "Enter a valid date");

export const phoneStr = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/[\s-]/g, "") : null))
  .refine((v) => !v || /^(\+?91)?[6-9]\d{9}$/.test(v) || /^\+?\d{10,15}$/.test(v), "Enter a valid mobile number");

export const gstinStr = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.toUpperCase() : null))
  .refine((v) => !v || isValidGSTIN(v), "Enter a valid 15-character GSTIN");

export const emailOpt = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email");

export const paymentMethod = z.enum(PAYMENT_METHODS);
export const idempotencyKey = z.string().min(8).max(100);
export const gstRateStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || "0")
  .refine((v) => /^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "Invalid GST rate");

// ---------------------------------------------------------------- parties
export const customerSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  mobile: phoneStr,
  whatsapp: phoneStr,
  email: emailOpt,
  address: optText(500),
  gstin: gstinStr,
  stateCode: optText(2),
  category: z.string().trim().max(40).optional().transform((v) => v || "Regular"),
  notes: optText(1000),
  openingBalance: signedAmountOrZero, // + they owe us, - we owe them (only used on create)
  assignedTo: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
});
export type CustomerInput = z.input<typeof customerSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  contactPerson: optText(120),
  mobile: phoneStr,
  whatsapp: phoneStr,
  email: emailOpt,
  address: optText(500),
  gstin: gstinStr,
  stateCode: optText(2),
  notes: optText(1000),
  openingBalance: signedAmountOrZero, // + we owe them, - they owe us
});
export type SupplierInput = z.input<typeof supplierSchema>;

// ---------------------------------------------------------------- khata
export const khataEntrySchema = z.object({
  partyType: z.enum(["CUSTOMER", "SUPPLIER"]),
  partyId: z.string().uuid(),
  kind: z.enum(["GAVE_GOODS", "GAVE_MONEY", "GOT_MONEY", "GOT_GOODS", "ADJUST_UP", "ADJUST_DOWN"]),
  amount: amountStr(),
  date: dateStr,
  description: optText(200),
  paymentMethod: paymentMethod.optional().nullable(),
  referenceNo: optText(80),
  notes: optText(1000),
  attachmentKey: optText(300),
  idempotencyKey,
});
export type KhataEntryInput = z.input<typeof khataEntrySchema>;

export const reverseSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
});

// ---------------------------------------------------------------- payments
export const paymentSchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  partyType: z.enum(["CUSTOMER", "SUPPLIER"]),
  partyId: z.string().uuid("Select a party"),
  amount: amountStr(),
  method: paymentMethod,
  date: dateStr,
  referenceNo: optText(80),
  notes: optText(1000),
  saleId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  purchaseId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  idempotencyKey,
});
export type PaymentInput = z.input<typeof paymentSchema>;

// ---------------------------------------------------------------- products
export const productSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(160),
  sku: optText(60),
  barcode: optText(60),
  hsnCode: optText(12),
  categoryId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  newCategory: optText(60),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  purchasePrice: amountOrZero("Purchase price"),
  sellingPrice: amountOrZero("Selling price"),
  gstRate: gstRateStr,
  minStock: qtyOrZero,
  openingStock: qtyOrZero,
  imageKey: optText(300),
});
export type ProductInput = z.input<typeof productSchema>;

export const stockAdjustSchema = z.object({
  productId: z.string().uuid(),
  kind: z.enum(["STOCK_IN", "STOCK_OUT", "SET"]),
  quantity: z.string().trim().refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "Enter a valid quantity"),
  unitCost: amountOrZero("Unit cost").optional(),
  date: dateStr,
  reason: z.string().trim().min(3, "Please give a reason").max(300),
  idempotencyKey,
});

// ---------------------------------------------------------------- sales & purchases
export const billLineSchema = z.object({
  productId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  description: z.string().trim().min(1, "Item name required").max(200),
  quantity: qtyStr,
  rate: amountOrZero("Rate"),
  discount: amountOrZero("Discount"),
  gstRate: gstRateStr,
  unit: z.string().trim().max(20).optional().transform((v) => v || "pcs"),
  hsnCode: optText(12),
});

export const saleSchema = z.object({
  customerId: z.string().uuid().optional().nullable().or(z.literal("").transform(() => null)),
  walkInName: optText(120),
  walkInMobile: phoneStr,
  date: dateStr,
  lines: z.array(billLineSchema).min(1, "Add at least one item").max(200),
  amountReceived: amountOrZero("Amount received"),
  paymentMethod: paymentMethod.default("CASH"),
  paymentReference: optText(80),
  notes: optText(1000),
  allowNegativeStock: z.boolean().optional().default(false),
  idempotencyKey,
});
export type SaleInput = z.input<typeof saleSchema>;

export const purchaseSchema = z.object({
  supplierId: z.string().uuid("Select a supplier"),
  supplierInvoiceNo: optText(60),
  date: dateStr,
  taxMode: z.enum(["NONE", "EXCLUSIVE", "INCLUSIVE"]),
  lines: z.array(billLineSchema.extend({ productId: z.string().uuid("Select a product") })).min(1, "Add at least one item").max(200),
  amountPaid: amountOrZero("Amount paid"),
  paymentMethod: paymentMethod.default("CASH"),
  paymentReference: optText(80),
  notes: optText(1000),
  attachmentKey: optText(300),
  idempotencyKey,
});
export type PurchaseInput = z.input<typeof purchaseSchema>;

export const cancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
  reversePayments: z.boolean().optional().default(true),
});

export const saleReturnSchema = z.object({
  saleId: z.string().uuid(),
  date: dateStr,
  items: z.array(z.object({ saleItemId: z.string().uuid(), quantity: qtyOrZero })).min(1),
  refundAmount: amountOrZero("Refund"),
  refundMethod: paymentMethod.default("CASH"),
  reason: z.string().trim().min(3, "Please give a reason").max(300),
  idempotencyKey,
});

// ---------------------------------------------------------------- expenses
export const expenseSchema = z.object({
  date: dateStr,
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  amount: amountStr(),
  paymentMethod,
  referenceNo: optText(80),
  payee: optText(120),
  description: optText(500),
  receiptKey: optText(300),
  idempotencyKey,
});
export type ExpenseInput = z.input<typeof expenseSchema>;

// ---------------------------------------------------------------- users
export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: phoneStr,
  role: z.enum(["ADMIN", "EMPLOYEE"]),
  password: z.string().optional(),
});
