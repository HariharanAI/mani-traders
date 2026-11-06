/**
 * MANI TRADERS — database schema (PostgreSQL).
 *
 * Money:     numeric(14,2) — never floating point. Converted to integer paise in code.
 * Quantity:  numeric(14,3)
 * Rates:     numeric(5,2)  (GST %)
 *
 * Accounting model: every financial event creates exactly one balanced
 * journal_entry (sum of debits == sum of credits). Party sub-ledgers
 * (customers / suppliers) are journal lines on the Accounts Receivable /
 * Accounts Payable control accounts tagged with party_type + party_id.
 * `ledger_transactions` is the human-facing khata row that points at the
 * journal entry it created. History is never updated in place: corrections
 * are made with reversal entries.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  date,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- enums
export const partyTypeEnum = pgEnum("party_type", ["CUSTOMER", "SUPPLIER"]);
export const accountTypeEnum = pgEnum("account_type", ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]);
export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "UPI", "BANK", "CHEQUE", "OTHER"]);
export const ledgerTxnTypeEnum = pgEnum("ledger_txn_type", [
  "OPENING_BALANCE", // opening balance for the party
  "CREDIT_GIVEN", // khata "You gave": goods/credit given to customer without itemised invoice
  "SALE", // itemised sale invoice (full invoice value)
  "PAYMENT_IN", // money received from party
  "PAYMENT_OUT", // money paid to party
  "SALES_RETURN", // credit note against a sale
  "PURCHASE", // supplier bill (full bill value)
  "PURCHASE_RETURN", // debit note against a purchase
  "ADJUSTMENT", // explicit balance adjustment (discount / write-off / correction)
  "REVERSAL", // reversal of an earlier entry
]);
export const recordStatusEnum = pgEnum("record_status", ["ACTIVE", "REVERSED", "REVERSAL", "CANCELLED"]);
export const paymentDirectionEnum = pgEnum("payment_direction", ["IN", "OUT"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "OPENING",
  "PURCHASE",
  "PURCHASE_CANCEL",
  "PURCHASE_RETURN",
  "SALE",
  "SALE_CANCEL",
  "SALE_RETURN",
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
]);
export const messageStatusEnum = pgEnum("message_status", [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "MANUAL_OPENED",
]);

// ---------------------------------------------------------------- access control
export const roles = pgTable("roles", {
  id: id(),
  key: text("key").notNull().unique(), // OWNER | ADMIN | EMPLOYEE
  name: text("name").notNull(),
  description: text("description"),
  createdAt: createdAt(),
});

export const permissions = pgTable("permissions", {
  id: id(),
  key: text("key").notNull().unique(),
  group: text("group").notNull(),
  description: text("description").notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- settings & numbering
export const businessSettings = pgTable("business_settings", {
  id: integer("id").primaryKey().default(1),
  businessName: text("business_name").notNull().default("MANI TRADERS"),
  legalName: text("legal_name"),
  tagline: text("tagline"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"), // GST state code, e.g. "33" for Tamil Nadu
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  logoKey: text("logo_key"),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  gstin: text("gstin"),
  gstScheme: text("gst_scheme").notNull().default("REGULAR"), // REGULAR | COMPOSITION
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
  invoicePrefix: text("invoice_prefix").notNull().default("MT"),
  receiptPrefix: text("receipt_prefix").notNull().default("RC"),
  purchasePrefix: text("purchase_prefix").notNull().default("PU"),
  invoiceTerms: text("invoice_terms"),
  invoiceFooter: text("invoice_footer").default("Thank you for your business."),
  bankDetails: text("bank_details"),
  upiId: text("upi_id"),
  fyStartMonth: integer("fy_start_month").notNull().default(4), // April
  currency: text("currency").notNull().default("INR"),
  dateFormat: text("date_format").notNull().default("DD-MM-YYYY"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  creditPeriodDays: integer("credit_period_days").notNull().default(30),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
  unusualTxnThreshold: money("unusual_txn_threshold").notNull().default("50000"),
  whatsappMode: text("whatsapp_mode").notNull().default("MANUAL"), // MANUAL | CLOUD_API
  whatsappTemplates: jsonb("whatsapp_templates").$type<Record<string, { name: string; language: string }>>().notNull().default({}),
  notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().notNull().default({}),
  backupEnabled: boolean("backup_enabled").notNull().default(true),
  backupRetentionDays: integer("backup_retention_days").notNull().default(30),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  lastDailyJobDate: date("last_daily_job_date"),
  updatedAt: updatedAt(),
});

/** Gap-free document counters, incremented inside the same DB transaction as the document. */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ---------------------------------------------------------------- parties
export const customers = pgTable(
  "customers",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    mobile: text("mobile"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    address: text("address"),
    gstin: text("gstin"),
    stateCode: text("state_code"),
    category: text("category").notNull().default("Regular"),
    notes: text("notes"),
    openingBalance: money("opening_balance").notNull().default("0"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("customers_name_idx").on(sql`lower(${t.name})`),
    index("customers_mobile_idx").on(t.mobile),
    index("customers_assigned_idx").on(t.assignedTo),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    mobile: text("mobile"),
    whatsapp: text("whatsapp"),
    email: text("email"),
    address: text("address"),
    gstin: text("gstin"),
    stateCode: text("state_code"),
    notes: text("notes"),
    openingBalance: money("opening_balance").notNull().default("0"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("suppliers_name_idx").on(sql`lower(${t.name})`), index("suppliers_mobile_idx").on(t.mobile)],
);

// ---------------------------------------------------------------- products
export const productCategories = pgTable("product_categories", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    sku: text("sku").unique(),
    barcode: text("barcode"),
    hsnCode: text("hsn_code"),
    categoryId: uuid("category_id").references(() => productCategories.id, { onDelete: "set null" }),
    unit: text("unit").notNull().default("pcs"),
    purchasePrice: money("purchase_price").notNull().default("0"),
    sellingPrice: money("selling_price").notNull().default("0"),
    gstRate: pct("gst_rate").notNull().default("0"),
    stockQty: qty("stock_qty").notNull().default("0"),
    minStock: qty("min_stock").notNull().default("0"),
    imageKey: text("image_key"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("products_name_idx").on(sql`lower(${t.name})`), index("products_barcode_idx").on(t.barcode)],
);

// ---------------------------------------------------------------- accounting core
export const ledgerAccounts = pgTable("ledger_accounts", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: createdAt(),
});

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    entryNo: text("entry_no").notNull().unique(),
    entryDate: date("entry_date").notNull(),
    memo: text("memo").notNull(),
    sourceType: text("source_type").notNull(), // SALE | PURCHASE | PAYMENT | EXPENSE | LEDGER | STOCK | SALE_RETURN ...
    sourceId: uuid("source_id"),
    reversalOfId: uuid("reversal_of_id"),
    isReversed: boolean("is_reversed").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("je_date_idx").on(t.entryDate), index("je_source_idx").on(t.sourceType, t.sourceId)],
);

export const journalEntryLines = pgTable(
  "journal_entry_lines",
  {
    id: id(),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id, { onDelete: "restrict" }),
    accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id),
    partyType: partyTypeEnum("party_type"),
    partyId: uuid("party_id"),
    debit: money("debit").notNull().default("0"),
    credit: money("credit").notNull().default("0"),
    description: text("description"),
  },
  (t) => [
    index("jel_entry_idx").on(t.journalEntryId),
    index("jel_account_idx").on(t.accountId),
    index("jel_party_idx").on(t.partyType, t.partyId),
    check("jel_nonneg", sql`${t.debit} >= 0 AND ${t.credit} >= 0`),
    check("jel_one_side", sql`NOT (${t.debit} > 0 AND ${t.credit} > 0)`),
  ],
);

/** Human-facing khata rows for customers & suppliers. `balanceEffect` is signed:
 *  customers: + increases receivable (they owe us more)
 *  suppliers: + increases payable   (we owe them more) */
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: id(),
    txnNo: text("txn_no").notNull().unique(),
    partyType: partyTypeEnum("party_type").notNull(),
    partyId: uuid("party_id").notNull(),
    txnDate: date("txn_date").notNull(),
    type: ledgerTxnTypeEnum("type").notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    balanceEffect: money("balance_effect").notNull(),
    paymentMethod: paymentMethodEnum("payment_method"),
    referenceNo: text("reference_no"),
    notes: text("notes"),
    attachmentKey: text("attachment_key"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    status: recordStatusEnum("status").notNull().default("ACTIVE"),
    reversalOfId: uuid("reversal_of_id"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversalReason: text("reversal_reason"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("lt_party_idx").on(t.partyType, t.partyId, t.txnDate),
    index("lt_date_idx").on(t.txnDate),
    index("lt_source_idx").on(t.sourceType, t.sourceId),
    check("lt_amount_pos", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------- sales
export const sales = pgTable(
  "sales",
  {
    id: id(),
    invoiceNo: text("invoice_no").notNull().unique(),
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: text("customer_name").notNull(), // snapshot (walk-in or customer at time of sale)
    customerMobile: text("customer_mobile"),
    customerAddress: text("customer_address"),
    customerGstin: text("customer_gstin"),
    saleDate: date("sale_date").notNull(),
    placeOfSupply: text("place_of_supply"),
    isInterstate: boolean("is_interstate").notNull().default(false),
    taxMode: text("tax_mode").notNull().default("NONE"), // NONE | EXCLUSIVE | INCLUSIVE
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default("0"),
    taxableTotal: money("taxable_total").notNull(),
    cgstTotal: money("cgst_total").notNull().default("0"),
    sgstTotal: money("sgst_total").notNull().default("0"),
    igstTotal: money("igst_total").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    grandTotal: money("grand_total").notNull(),
    costTotal: money("cost_total").notNull().default("0"),
    notes: text("notes"),
    status: recordStatusEnum("status").notNull().default("ACTIVE"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("sales_date_idx").on(t.saleDate), index("sales_customer_idx").on(t.customerId)],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    description: text("description").notNull(),
    hsnCode: text("hsn_code"),
    unit: text("unit").notNull().default("pcs"),
    quantity: qty("quantity").notNull(),
    rate: money("rate").notNull(),
    discount: money("discount").notNull().default("0"),
    taxable: money("taxable").notNull(),
    gstRate: pct("gst_rate").notNull().default("0"),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    total: money("total").notNull(),
    unitCost: money("unit_cost").notNull().default("0"),
    returnedQty: qty("returned_qty").notNull().default("0"),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId), index("sale_items_product_idx").on(t.productId)],
);

export const saleReturns = pgTable(
  "sale_returns",
  {
    id: id(),
    returnNo: text("return_no").notNull().unique(),
    saleId: uuid("sale_id").notNull().references(() => sales.id),
    customerId: uuid("customer_id").references(() => customers.id),
    returnDate: date("return_date").notNull(),
    taxableTotal: money("taxable_total").notNull(),
    taxTotal: money("tax_total").notNull(),
    grandTotal: money("grand_total").notNull(),
    costTotal: money("cost_total").notNull().default("0"),
    refundAmount: money("refund_amount").notNull().default("0"),
    refundMethod: paymentMethodEnum("refund_method"),
    reason: text("reason"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("sale_returns_sale_idx").on(t.saleId)],
);

export const saleReturnItems = pgTable("sale_return_items", {
  id: id(),
  saleReturnId: uuid("sale_return_id").notNull().references(() => saleReturns.id, { onDelete: "cascade" }),
  saleItemId: uuid("sale_item_id").notNull().references(() => saleItems.id),
  quantity: qty("quantity").notNull(),
  taxable: money("taxable").notNull(),
  tax: money("tax").notNull(),
  total: money("total").notNull(),
});

// ---------------------------------------------------------------- purchases
export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    purchaseNo: text("purchase_no").notNull().unique(),
    supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
    supplierInvoiceNo: text("supplier_invoice_no"),
    purchaseDate: date("purchase_date").notNull(),
    isInterstate: boolean("is_interstate").notNull().default(false),
    taxMode: text("tax_mode").notNull().default("NONE"),
    subtotal: money("subtotal").notNull(),
    discountTotal: money("discount_total").notNull().default("0"),
    taxableTotal: money("taxable_total").notNull(),
    cgstTotal: money("cgst_total").notNull().default("0"),
    sgstTotal: money("sgst_total").notNull().default("0"),
    igstTotal: money("igst_total").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    grandTotal: money("grand_total").notNull(),
    notes: text("notes"),
    attachmentKey: text("attachment_key"),
    status: recordStatusEnum("status").notNull().default("ACTIVE"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("purchases_date_idx").on(t.purchaseDate), index("purchases_supplier_idx").on(t.supplierId)],
);

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: id(),
    purchaseId: uuid("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id),
    description: text("description").notNull(),
    unit: text("unit").notNull().default("pcs"),
    quantity: qty("quantity").notNull(),
    rate: money("rate").notNull(),
    discount: money("discount").notNull().default("0"),
    taxable: money("taxable").notNull(),
    gstRate: pct("gst_rate").notNull().default("0"),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    total: money("total").notNull(),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId), index("purchase_items_product_idx").on(t.productId)],
);

// ---------------------------------------------------------------- payments
export const payments = pgTable(
  "payments",
  {
    id: id(),
    paymentNo: text("payment_no").notNull().unique(), // RC/.. for IN, PV/.. for OUT
    direction: paymentDirectionEnum("direction").notNull(),
    partyType: partyTypeEnum("party_type").notNull(),
    partyId: uuid("party_id").notNull(),
    paymentDate: date("payment_date").notNull(),
    amount: money("amount").notNull(),
    method: paymentMethodEnum("method").notNull(),
    referenceNo: text("reference_no"),
    notes: text("notes"),
    saleId: uuid("sale_id").references(() => sales.id),
    purchaseId: uuid("purchase_id").references(() => purchases.id),
    balanceAfter: money("balance_after"), // party balance right after this payment (snapshot for the receipt)
    ledgerTransactionId: uuid("ledger_transaction_id").references(() => ledgerTransactions.id),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    status: recordStatusEnum("status").notNull().default("ACTIVE"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_date_idx").on(t.paymentDate),
    index("payments_party_idx").on(t.partyType, t.partyId),
    check("payments_amount_pos", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------- inventory
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id),
    movementDate: date("movement_date").notNull(),
    type: movementTypeEnum("type").notNull(),
    quantity: qty("quantity").notNull(), // signed: + in, - out
    unitCost: money("unit_cost").notNull().default("0"),
    balanceAfter: qty("balance_after").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    reason: text("reason"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("im_product_idx").on(t.productId, t.createdAt), index("im_date_idx").on(t.movementDate)],
);

// ---------------------------------------------------------------- expenses
export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    expenseNo: text("expense_no").notNull().unique(),
    expenseDate: date("expense_date").notNull(),
    category: text("category").notNull(),
    amount: money("amount").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    referenceNo: text("reference_no"),
    payee: text("payee"),
    description: text("description"),
    receiptKey: text("receipt_key"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    status: recordStatusEnum("status").notNull().default("ACTIVE"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("expenses_date_idx").on(t.expenseDate),
    index("expenses_cat_idx").on(t.category),
    check("expenses_amount_pos", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------- documents
export const invoices = pgTable("invoices", {
  id: id(),
  invoiceNo: text("invoice_no").notNull().unique(),
  saleId: uuid("sale_id").notNull().unique().references(() => sales.id),
  customerId: uuid("customer_id").references(() => customers.id),
  invoiceDate: date("invoice_date").notNull(),
  grandTotal: money("grand_total").notNull(),
  fileKey: text("file_key"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  downloadCount: integer("download_count").notNull().default(0),
  status: recordStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: createdAt(),
});

export const receipts = pgTable("receipts", {
  id: id(),
  receiptNo: text("receipt_no").notNull().unique(),
  paymentId: uuid("payment_id").notNull().unique().references(() => payments.id),
  fileKey: text("file_key"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- notifications & messaging
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    severity: text("severity").notNull().default("info"), // info | success | warning | danger
    audience: text("audience").notNull().default("OWNER"), // OWNER | MANAGERS | ALL
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

export const messageLogs = pgTable(
  "message_logs",
  {
    id: id(),
    channel: text("channel").notNull().default("WHATSAPP"),
    mode: text("mode").notNull(), // CLOUD_API | MANUAL
    messageType: text("message_type").notNull(), // REMINDER | PAYMENT_CONFIRMATION | STATEMENT | INVOICE | RECEIPT | MONTHLY_SUMMARY
    toNumber: text("to_number").notNull(),
    partyType: partyTypeEnum("party_type"),
    partyId: uuid("party_id"),
    templateName: text("template_name"),
    body: text("body").notNull(),
    documentRef: text("document_ref"),
    providerMessageId: text("provider_message_id"),
    status: messageStatusEnum("status").notNull(),
    statusHistory: jsonb("status_history").$type<{ status: string; at: string; detail?: string }[]>().notNull().default([]),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ml_party_idx").on(t.partyType, t.partyId),
    index("ml_provider_idx").on(t.providerMessageId),
    index("ml_created_idx").on(t.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);
