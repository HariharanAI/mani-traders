export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

/** System chart of accounts. Codes are stable identifiers used by the posting engine. */
export const ACC = {
  CASH: "1000",
  BANK: "1010",
  UPI: "1020",
  OTHER_MONEY: "1030",
  RECEIVABLE: "1100",
  INVENTORY: "1200",
  GST_INPUT: "1300",
  PAYABLE: "2000",
  GST_OUTPUT: "2100",
  OPENING_EQUITY: "3000",
  CAPITAL: "3100",
  SALES: "4000",
  SALES_RETURNS: "4010",
  OTHER_INCOME: "4100",
  ROUND_OFF: "4200",
  COGS: "5000",
  STOCK_ADJUST: "5100",
  DISCOUNTS_WRITEOFF: "5200",
} as const;

export const EXPENSE_CATEGORIES = [
  { key: "Rent", code: "6001" },
  { key: "Electricity", code: "6002" },
  { key: "Transport", code: "6003" },
  { key: "Salary", code: "6004" },
  { key: "Maintenance", code: "6005" },
  { key: "Purchases", code: "6006" },
  { key: "Miscellaneous", code: "6007" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as [ExpenseCategory, ...ExpenseCategory[]];

export const CHART_OF_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: ACC.CASH, name: "Cash in Hand", type: "ASSET" },
  { code: ACC.BANK, name: "Bank Account", type: "ASSET" },
  { code: ACC.UPI, name: "UPI Collections", type: "ASSET" },
  { code: ACC.OTHER_MONEY, name: "Other Payment Accounts", type: "ASSET" },
  { code: ACC.RECEIVABLE, name: "Accounts Receivable (Customers)", type: "ASSET" },
  { code: ACC.INVENTORY, name: "Inventory", type: "ASSET" },
  { code: ACC.GST_INPUT, name: "GST Input Credit", type: "ASSET" },
  { code: ACC.PAYABLE, name: "Accounts Payable (Suppliers)", type: "LIABILITY" },
  { code: ACC.GST_OUTPUT, name: "GST Output Payable", type: "LIABILITY" },
  { code: ACC.OPENING_EQUITY, name: "Opening Balance Equity", type: "EQUITY" },
  { code: ACC.CAPITAL, name: "Owner's Capital", type: "EQUITY" },
  { code: ACC.SALES, name: "Sales Revenue", type: "INCOME" },
  { code: ACC.SALES_RETURNS, name: "Sales Returns", type: "INCOME" },
  { code: ACC.OTHER_INCOME, name: "Other Income & Discounts Received", type: "INCOME" },
  { code: ACC.ROUND_OFF, name: "Round Off", type: "INCOME" },
  { code: ACC.COGS, name: "Cost of Goods Sold", type: "EXPENSE" },
  { code: ACC.STOCK_ADJUST, name: "Inventory Adjustments", type: "EXPENSE" },
  { code: ACC.DISCOUNTS_WRITEOFF, name: "Discounts Allowed & Write-offs", type: "EXPENSE" },
  ...EXPENSE_CATEGORIES.map((c) => ({ code: c.code, name: `${c.key} Expense`, type: "EXPENSE" as const })),
];

export const PAYMENT_METHODS = ["CASH", "UPI", "BANK", "CHEQUE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

/** Which money account a payment method posts to. Cheques are treated as deposited into the bank. */
export function moneyAccountFor(method: PaymentMethod): string {
  switch (method) {
    case "CASH":
      return ACC.CASH;
    case "UPI":
      return ACC.UPI;
    case "BANK":
    case "CHEQUE":
      return ACC.BANK;
    default:
      return ACC.OTHER_MONEY;
  }
}

export const MONEY_ACCOUNT_CODES = [ACC.CASH, ACC.BANK, ACC.UPI, ACC.OTHER_MONEY];
