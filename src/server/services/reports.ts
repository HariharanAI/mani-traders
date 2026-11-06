/**
 * Dashboard metrics and reports. Everything is computed from authoritative
 * records: the journal for revenue / profit / cash flow, payments for
 * collections, khata rows for party balances. Terms are kept distinct:
 *  - Sales (revenue)   = goods/services billed (net of returns), excl. GST
 *  - Collections       = money actually received from customers
 *  - Profit estimate   = revenue − cost of goods sold − expenses
 *  - Net cash flow     = change in cash + bank + UPI balances
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Executor } from "../db/client";
import * as s from "../db/schema";
import { assertCan, getSettingsRow, type Actor } from "../core";
import { ACC, EXPENSE_CATEGORIES, MONEY_ACCOUNT_CODES, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { toMilli, toPaise, type Paise } from "@/lib/money";
import { addDays, addMonths, diffDays, eachDay, endOfMonth, financialYear, financialYearRange, formatDate, monthLabel, startOfMonth, todayIST } from "@/lib/dates";
import { customerTotals, listCustomers, listSuppliers, supplierTotals, customerScope } from "./parties";
import { inventorySummary, listProducts } from "./inventory";
import { partyStatement, recentLedger } from "./khata";

type Range = { from: string; to: string };

/** Σ(debit − credit) per account code for journal entries dated within the range. */
async function glMovement(db: Executor, codes: string[], r: Partial<Range>) {
  const rows = await db
    .select({ code: s.ledgerAccounts.code, net: sql<string>`coalesce(sum(${s.journalEntryLines.debit} - ${s.journalEntryLines.credit}), 0)` })
    .from(s.journalEntryLines)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.journalEntryLines.accountId))
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalEntryLines.journalEntryId))
    .where(and(inArray(s.ledgerAccounts.code, codes), r.from ? gte(s.journalEntries.entryDate, r.from) : undefined, r.to ? lte(s.journalEntries.entryDate, r.to) : undefined))
    .groupBy(s.ledgerAccounts.code);
  const map = new Map<string, Paise>(codes.map((c) => [c, 0]));
  for (const r2 of rows) map.set(r2.code, toPaise(r2.net));
  return map;
}

/** Daily or monthly GL series for given accounts. */
async function glSeries(db: Executor, codes: string[], r: Range, bucket: "day" | "month") {
  const key = bucket === "day" ? sql<string>`${s.journalEntries.entryDate}::text` : sql<string>`to_char(${s.journalEntries.entryDate}, 'YYYY-MM')`;
  const rows = await db
    .select({ k: key, code: s.ledgerAccounts.code, net: sql<string>`sum(${s.journalEntryLines.debit} - ${s.journalEntryLines.credit})` })
    .from(s.journalEntryLines)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.journalEntryLines.accountId))
    .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalEntryLines.journalEntryId))
    .where(and(inArray(s.ledgerAccounts.code, codes), gte(s.journalEntries.entryDate, r.from), lte(s.journalEntries.entryDate, r.to)))
    .groupBy(key, s.ledgerAccounts.code);
  return rows.map((x) => ({ k: x.k, code: x.code, net: toPaise(x.net) }));
}

const EXPENSE_CODES = EXPENSE_CATEGORIES.map((c) => c.code);

async function collections(db: Executor, r: Range) {
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${s.payments.amount}), 0)`, n: sql<number>`count(*)::int` })
    .from(s.payments)
    .where(and(eq(s.payments.direction, "IN"), eq(s.payments.status, "ACTIVE"), sql`(${s.payments.partyType} is null or ${s.payments.partyType} = 'CUSTOMER')`, gte(s.payments.paymentDate, r.from), lte(s.payments.paymentDate, r.to)));
  return { amount: toPaise(row.v), count: row.n };
}

async function expenseTotal(db: Executor, r: Range) {
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${s.expenses.amount}), 0)` })
    .from(s.expenses)
    .where(and(eq(s.expenses.status, "ACTIVE"), gte(s.expenses.expenseDate, r.from), lte(s.expenses.expenseDate, r.to)));
  return toPaise(row.v);
}

/** Revenue figures from the GL (credit-positive). */
async function revenue(db: Executor, r: Range) {
  const m = await glMovement(db, [ACC.SALES, ACC.SALES_RETURNS, ACC.COGS, ACC.GST_OUTPUT], r);
  const gross = -(m.get(ACC.SALES) ?? 0);
  const returns = m.get(ACC.SALES_RETURNS) ?? 0;
  return { gross, returns, net: gross - returns, cogs: m.get(ACC.COGS) ?? 0 };
}

export async function overdueCustomers(db: Executor, actor: Actor, limit = 50) {
  const settings = await getSettingsRow(db);
  const today = todayIST();
  const { rows } = await listCustomers(db, actor, { status: "owes", sort: "balance", limit: 1000 });
  return rows
    .map((c) => {
      const since = c.lastPayment ?? c.firstTxn ?? today;
      return { ...c, daysSincePayment: diffDays(today, since) };
    })
    .filter((c) => c.daysSincePayment > settings.creditPeriodDays)
    .slice(0, limit);
}

export async function dashboard(db: Executor, actor: Actor, range: Range) {
  assertCan(actor, "dashboard.financials");
  const settings = await getSettingsRow(db);
  const today = todayIST();
  const [cust, sup, inv, rev, coll, exp, cash] = await Promise.all([
    customerTotals(db, actor),
    supplierTotals(db),
    inventorySummary(db),
    revenue(db, range),
    collections(db, range),
    expenseTotal(db, range),
    glMovement(db, MONEY_ACCOUNT_CODES, range),
  ]);
  const netCash = [...cash.values()].reduce((a, b) => a + b, 0);
  const overdue = await overdueCustomers(db, actor, 8);
  const overdueTotal = (await overdueCustomers(db, actor, 10000)).reduce((a, c) => a + c.balance, 0);
  const [salesCount] = await db
    .select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${s.sales.grandTotal}), 0)` })
    .from(s.sales)
    .where(and(eq(s.sales.status, "ACTIVE"), gte(s.sales.saleDate, range.from), lte(s.sales.saleDate, range.to)));
  const [supCount] = await db.select({ n: sql<number>`count(*)::int` }).from(s.suppliers).where(isNull(s.suppliers.archivedAt));

  // Daily chart: at least the last 14 days so a one-day filter still shows a trend
  const chartFrom = diffDays(range.to, range.from) < 13 ? addDays(range.to, -13) : range.from;
  const days = eachDay(chartFrom, range.to);
  const daySeries = await glSeries(db, [ACC.SALES, ACC.SALES_RETURNS], { from: chartFrom, to: range.to }, "day");
  const dayColl = await db
    .select({ d: sql<string>`${s.payments.paymentDate}::text`, v: sql<string>`sum(${s.payments.amount})` })
    .from(s.payments)
    .where(and(eq(s.payments.direction, "IN"), eq(s.payments.status, "ACTIVE"), sql`(${s.payments.partyType} is null or ${s.payments.partyType} = 'CUSTOMER')`, gte(s.payments.paymentDate, chartFrom), lte(s.payments.paymentDate, range.to)))
    .groupBy(s.payments.paymentDate);
  const daily = days.map((d) => ({
    date: d,
    label: formatDate(d).slice(0, 5),
    sales: -daySeries.filter((x) => x.k === d).reduce((a, x) => a + x.net, 0),
    collections: toPaise(dayColl.find((x) => x.d === d)?.v ?? "0"),
  }));

  // Monthly: last 12 months revenue, cost, expenses, credit given vs collected
  const mFrom = addMonths(startOfMonth(today), -11);
  const mSeries = await glSeries(db, [ACC.SALES, ACC.SALES_RETURNS, ACC.COGS, ...EXPENSE_CODES], { from: mFrom, to: endOfMonth(today) }, "month");
  const creditByMonth = await db
    .select({
      m: sql<string>`to_char(${s.ledgerTransactions.txnDate}, 'YYYY-MM')`,
      given: sql<string>`coalesce(sum(case when ${s.ledgerTransactions.balanceEffect} > 0 and ${s.ledgerTransactions.type} in ('SALE','CREDIT_GIVEN') then ${s.ledgerTransactions.balanceEffect} end), 0)`,
      collected: sql<string>`coalesce(sum(case when ${s.ledgerTransactions.type} = 'PAYMENT_IN' then ${s.ledgerTransactions.amount} end), 0)`,
    })
    .from(s.ledgerTransactions)
    .where(and(eq(s.ledgerTransactions.partyType, "CUSTOMER"), eq(s.ledgerTransactions.status, "ACTIVE"), gte(s.ledgerTransactions.txnDate, mFrom)))
    .groupBy(sql`1`);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const ym = addMonths(mFrom, i).slice(0, 7);
    const rows = mSeries.filter((x) => x.k === ym);
    const get = (codes: string[]) => rows.filter((x) => codes.includes(x.code)).reduce((a, x) => a + x.net, 0);
    const revenueM = -get([ACC.SALES, ACC.SALES_RETURNS]);
    const cogs = get([ACC.COGS]);
    const expenses = get(EXPENSE_CODES);
    const cr = creditByMonth.find((c) => c.m === ym);
    return { month: ym, label: monthLabel(ym), revenue: revenueM, cogs, expenses, profit: revenueM - cogs - expenses, creditGiven: toPaise(cr?.given ?? "0"), collected: toPaise(cr?.collected ?? "0") };
  });

  // Top customers by billed sales in range
  const top = await db
    .select({ id: s.customers.id, name: s.customers.name, total: sql<string>`sum(${s.sales.grandTotal})`, n: sql<number>`count(*)::int` })
    .from(s.sales)
    .innerJoin(s.customers, eq(s.customers.id, s.sales.customerId))
    .where(and(eq(s.sales.status, "ACTIVE"), gte(s.sales.saleDate, range.from), lte(s.sales.saleDate, range.to), customerScope(actor)))
    .groupBy(s.customers.id, s.customers.name)
    .orderBy(desc(sql`sum(${s.sales.grandTotal})`))
    .limit(6);
  const recentPayments = await db
    .select({ id: s.payments.id, paymentNo: s.payments.paymentNo, amount: s.payments.amount, method: s.payments.method, date: s.payments.paymentDate, direction: s.payments.direction, partyName: sql<string>`coalesce(${s.customers.name}, ${s.suppliers.name}, 'Walk-in customer')` })
    .from(s.payments)
    .leftJoin(s.customers, and(eq(s.payments.partyType, "CUSTOMER"), eq(s.customers.id, s.payments.partyId)))
    .leftJoin(s.suppliers, and(eq(s.payments.partyType, "SUPPLIER"), eq(s.suppliers.id, s.payments.partyId)))
    .where(eq(s.payments.status, "ACTIVE"))
    .orderBy(desc(s.payments.createdAt))
    .limit(6);
  const recentPurchases = await db
    .select({ id: s.purchases.id, purchaseNo: s.purchases.purchaseNo, total: s.purchases.grandTotal, date: s.purchases.purchaseDate, supplier: s.suppliers.name })
    .from(s.purchases)
    .innerJoin(s.suppliers, eq(s.suppliers.id, s.purchases.supplierId))
    .where(eq(s.purchases.status, "ACTIVE"))
    .orderBy(desc(s.purchases.createdAt))
    .limit(5);
  const lowStock = (await listProducts(db, actor, { stock: "low", limit: 6, sort: "stock" })).rows;
  const recent = await recentLedger(db, actor, { limit: 8 });

  // Business performance
  const creditSales = monthly.reduce((a, m) => a + m.creditGiven, 0);
  const collectedYr = monthly.reduce((a, m) => a + m.collected, 0);
  const performance = {
    grossMargin: rev.net > 0 ? Math.round(((rev.net - rev.cogs) / rev.net) * 1000) / 10 : null,
    expenseRatio: rev.net > 0 ? Math.round((exp / rev.net) * 1000) / 10 : null,
    avgInvoice: salesCount.n > 0 ? Math.round(toPaise(salesCount.v) / salesCount.n) : 0,
    collectionRate: creditSales > 0 ? Math.round((collectedYr / creditSales) * 1000) / 10 : null,
    invoices: salesCount.n,
    grossProfit: rev.net - rev.cogs,
    profitEstimate: rev.net - rev.cogs - exp,
  };

  return {
    metrics: {
      receivables: cust.receivable,
      payables: sup.payable,
      sales: rev.net,
      salesBilled: toPaise(salesCount.v),
      collections: coll.amount,
      collectionsCount: coll.count,
      expenses: exp,
      overdue: overdueTotal,
      customers: cust.count,
      customersOwing: cust.owing,
      suppliers: supCount.n,
      inventoryValue: inv.value,
      lowStockCount: inv.low,
      netCash,
    },
    daily,
    monthly,
    top: top.map((t) => ({ ...t, total: toPaise(t.total) })),
    overdue,
    recentPayments: recentPayments.map((p) => ({ ...p, amount: toPaise(p.amount) })),
    recentPurchases: recentPurchases.map((p) => ({ ...p, total: toPaise(p.total) })),
    lowStock,
    recent,
    performance,
    creditPeriodDays: settings.creditPeriodDays,
  };
}

/** Today snapshot for employees/admins without financial access. */
export async function counterSummary(db: Executor, actor: Actor) {
  const today = todayIST();
  const [mine] = await db
    .select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${s.sales.grandTotal}), 0)` })
    .from(s.sales)
    .where(and(eq(s.sales.status, "ACTIVE"), eq(s.sales.saleDate, today), eq(s.sales.createdBy, actor.id)));
  const [pay] = await db
    .select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${s.payments.amount}), 0)` })
    .from(s.payments)
    .where(and(eq(s.payments.status, "ACTIVE"), eq(s.payments.direction, "IN"), eq(s.payments.paymentDate, today), eq(s.payments.createdBy, actor.id)));
  return { salesCount: mine.n, salesAmount: toPaise(mine.v), paymentsCount: pay.n, paymentsAmount: toPaise(pay.v) };
}

// ====================================================================== reports
export type ColKind = "text" | "money" | "qty" | "date" | "number" | "percent";
export type ReportColumn = { key: string; label: string; kind: ColKind };
export type ReportRow = Record<string, string | number | null>;
export type Report = {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow;
  summary?: { label: string; value: number; kind: ColKind; tone?: "pos" | "neg" }[];
  note?: string;
};

export const REPORTS = [
  { key: "daily-sales", title: "Daily sales", group: "Sales", needsRange: true, desc: "Invoices, tax, returns and collections per day" },
  { key: "monthly-sales", title: "Monthly sales", group: "Sales", needsRange: true, desc: "Month-wise billed sales and collections" },
  { key: "yearly-sales", title: "Yearly sales", group: "Sales", needsRange: false, desc: "Financial-year totals" },
  { key: "product-sales", title: "Product-wise sales", group: "Sales", needsRange: true, desc: "Quantity, revenue and margin per product" },
  { key: "customer-outstanding", title: "Customer outstanding", group: "Parties", needsRange: false, desc: "Who owes you, and since when" },
  { key: "supplier-payable", title: "Supplier payable", group: "Parties", needsRange: false, desc: "Whom you owe" },
  { key: "customer-statement", title: "Customer statement", group: "Parties", needsRange: true, needsParty: "CUSTOMER", desc: "Ledger with running balance" },
  { key: "supplier-statement", title: "Supplier statement", group: "Parties", needsRange: true, needsParty: "SUPPLIER", desc: "Ledger with running balance" },
  { key: "payment-collection", title: "Payment collection", group: "Money", needsRange: true, desc: "Money received, by method" },
  { key: "expense-report", title: "Expenses", group: "Money", needsRange: true, desc: "Expenses with category breakdown" },
  { key: "profit-estimate", title: "Profit estimate", group: "Money", needsRange: true, desc: "Revenue − cost of goods − expenses" },
  { key: "cash-flow", title: "Cash flow", group: "Money", needsRange: true, desc: "Money in and out of cash, bank and UPI" },
  { key: "gst-summary", title: "GST summary", group: "Money", needsRange: true, desc: "Output tax, input credit and net payable" },
  { key: "inventory-valuation", title: "Inventory valuation", group: "Stock", needsRange: false, desc: "Stock on hand at average cost" },
  { key: "stock-movement", title: "Stock movement", group: "Stock", needsRange: true, desc: "Every stock in / out with reason" },
  { key: "trial-balance", title: "Trial balance & integrity", group: "Accounts", needsRange: false, desc: "Ledger totals and consistency checks" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

const C = (key: string, label: string, kind: ColKind = "text"): ReportColumn => ({ key, label, kind });
const rangeLabel = (r: Range) => (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`);

export async function buildReport(db: Executor, actor: Actor, key: ReportKey, r: Range, opts: { partyId?: string; q?: string } = {}): Promise<Report> {
  const isStatement = key === "customer-statement" || key === "supplier-statement";
  if (!isStatement) assertCan(actor, "reports.view");
  const settings = await getSettingsRow(db);
  const def = REPORTS.find((x) => x.key === key)!;
  const sub = def.needsRange ? rangeLabel(r) : `As on ${formatDate(todayIST())}`;
  const base = { key, title: def.title, subtitle: sub };

  switch (key) {
    case "daily-sales":
    case "monthly-sales":
    case "yearly-sales": {
      const bucket = key === "daily-sales" ? sql<string>`${s.sales.saleDate}::text` : key === "monthly-sales" ? sql<string>`to_char(${s.sales.saleDate}, 'YYYY-MM')` : sql<string>`${s.sales.saleDate}::text`;
      const where = and(eq(s.sales.status, "ACTIVE"), key === "yearly-sales" ? undefined : gte(s.sales.saleDate, r.from), key === "yearly-sales" ? undefined : lte(s.sales.saleDate, r.to));
      const rows = await db
        .select({
          k: bucket,
          n: sql<number>`count(*)::int`,
          taxable: sql<string>`sum(${s.sales.taxableTotal})`,
          tax: sql<string>`sum(${s.sales.cgstTotal} + ${s.sales.sgstTotal} + ${s.sales.igstTotal})`,
          total: sql<string>`sum(${s.sales.grandTotal})`,
          cost: sql<string>`sum(${s.sales.costTotal})`,
        })
        .from(s.sales)
        .where(where)
        .groupBy(bucket)
        .orderBy(bucket);
      const retBucket = key === "monthly-sales" ? sql<string>`to_char(${s.saleReturns.returnDate}, 'YYYY-MM')` : sql<string>`${s.saleReturns.returnDate}::text`;
      const rets = await db
        .select({ k: retBucket, v: sql<string>`sum(${s.saleReturns.grandTotal})` })
        .from(s.saleReturns)
        .where(key === "yearly-sales" ? undefined : and(gte(s.saleReturns.returnDate, r.from), lte(s.saleReturns.returnDate, r.to)))
        .groupBy(retBucket);
      const payBucket = key === "monthly-sales" ? sql<string>`to_char(${s.payments.paymentDate}, 'YYYY-MM')` : sql<string>`${s.payments.paymentDate}::text`;
      const pays = await db
        .select({ k: payBucket, v: sql<string>`sum(${s.payments.amount})` })
        .from(s.payments)
        .where(and(eq(s.payments.direction, "IN"), eq(s.payments.status, "ACTIVE"), sql`(${s.payments.partyType} is null or ${s.payments.partyType} = 'CUSTOMER')`, key === "yearly-sales" ? undefined : gte(s.payments.paymentDate, r.from), key === "yearly-sales" ? undefined : lte(s.payments.paymentDate, r.to)))
        .groupBy(payBucket);
      type Agg = { n: number; taxable: number; tax: number; total: number; cost: number; returns: number; collections: number };
      const groups = new Map<string, Agg>();
      const keyOf = (k: string) => (key === "yearly-sales" ? financialYear(k, settings.fyStartMonth) : k);
      const g = (k: string) => {
        const kk = keyOf(k);
        if (!groups.has(kk)) groups.set(kk, { n: 0, taxable: 0, tax: 0, total: 0, cost: 0, returns: 0, collections: 0 });
        return groups.get(kk)!;
      };
      for (const x of rows) {
        const a = g(x.k);
        a.n += x.n;
        a.taxable += toPaise(x.taxable);
        a.tax += toPaise(x.tax);
        a.total += toPaise(x.total);
        a.cost += toPaise(x.cost);
      }
      for (const x of rets) g(x.k).returns += toPaise(x.v);
      for (const x of pays) g(x.k).collections += toPaise(x.v);
      const out = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, a]) => ({
          period: key === "daily-sales" ? formatDate(k) : key === "monthly-sales" ? monthLabel(k) : `FY ${k}`,
          invoices: a.n,
          taxable: a.taxable,
          tax: a.tax,
          total: a.total,
          returns: a.returns,
          net: a.total - a.returns,
          collections: a.collections,
        }));
      const sumK = (k: keyof (typeof out)[number]) => out.reduce((acc, x) => acc + (x[k] as number), 0);
      return {
        ...base,
        subtitle: key === "yearly-sales" ? "All financial years" : sub,
        columns: [C("period", key === "daily-sales" ? "Date" : key === "monthly-sales" ? "Month" : "Year"), C("invoices", "Invoices", "number"), C("taxable", "Taxable value", "money"), C("tax", "GST", "money"), C("total", "Billed", "money"), C("returns", "Returns", "money"), C("net", "Net sales", "money"), C("collections", "Collections", "money")],
        rows: out,
        totals: { period: "Total", invoices: sumK("invoices"), taxable: sumK("taxable"), tax: sumK("tax"), total: sumK("total"), returns: sumK("returns"), net: sumK("net"), collections: sumK("collections") },
        note: "Billed includes GST. Collections are money received in the period (against any invoice) and are not counted as additional revenue.",
      };
    }

    case "product-sales": {
      const rows = await db
        .select({
          name: s.saleItems.description,
          productId: s.saleItems.productId,
          unit: s.saleItems.unit,
          qty: sql<string>`sum(${s.saleItems.quantity} - ${s.saleItems.returnedQty})`,
          taxable: sql<string>`round(sum(${s.saleItems.taxable} * (${s.saleItems.quantity} - ${s.saleItems.returnedQty}) / ${s.saleItems.quantity}), 2)`,
          cost: sql<string>`round(sum((${s.saleItems.quantity} - ${s.saleItems.returnedQty}) * ${s.saleItems.unitCost}), 2)`,
          n: sql<number>`count(distinct ${s.saleItems.saleId})::int`,
        })
        .from(s.saleItems)
        .innerJoin(s.sales, eq(s.sales.id, s.saleItems.saleId))
        .where(and(eq(s.sales.status, "ACTIVE"), gte(s.sales.saleDate, r.from), lte(s.sales.saleDate, r.to)))
        .groupBy(s.saleItems.description, s.saleItems.productId, s.saleItems.unit)
        .orderBy(desc(sql`sum(${s.saleItems.taxable})`));
      const out = rows.map((x) => {
        const rev = toPaise(x.taxable);
        const cost = toPaise(x.cost);
        return { product: x.name, unit: x.unit, invoices: x.n, qty: toMilli(x.qty), revenue: rev, cost, margin: rev - cost, marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : 0 };
      });
      const rev = out.reduce((a, x) => a + x.revenue, 0);
      const cost = out.reduce((a, x) => a + x.cost, 0);
      return {
        ...base,
        columns: [C("product", "Product"), C("unit", "Unit"), C("invoices", "Invoices", "number"), C("qty", "Qty sold (net)", "qty"), C("revenue", "Revenue (excl. GST)", "money"), C("cost", "Cost", "money"), C("margin", "Margin", "money"), C("marginPct", "Margin %", "percent")],
        rows: out,
        totals: { product: "Total", revenue: rev, cost, margin: rev - cost, marginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : 0 },
        note: "Net of returns. Cost is the moving-average purchase cost at the time of sale.",
      };
    }

    case "customer-outstanding": {
      const today = todayIST();
      const { rows } = await listCustomers(db, actor, { status: "all", sort: "balance", limit: 10000, q: opts.q });
      const out = rows
        .filter((c) => c.balance !== 0)
        .map((c) => ({
          code: c.code,
          name: c.name,
          mobile: c.mobile,
          given: c.given,
          received: c.received,
          balance: c.balance,
          status: c.balance > 0 ? "Owes us" : "Advance (we owe)",
          lastPayment: c.lastPayment ? formatDate(c.lastPayment) : "Never",
          days: diffDays(today, c.lastPayment ?? c.firstTxn ?? today),
        }));
      const owe = out.filter((x) => x.balance > 0).reduce((a, x) => a + x.balance, 0);
      const adv = out.filter((x) => x.balance < 0).reduce((a, x) => a - x.balance, 0);
      return {
        ...base,
        columns: [C("code", "ID"), C("name", "Customer"), C("mobile", "Mobile"), C("given", "Total given", "money"), C("received", "Total received", "money"), C("balance", "Balance", "money"), C("status", "Status"), C("lastPayment", "Last payment"), C("days", "Days since payment", "number")],
        rows: out,
        summary: [
          { label: "Total receivable", value: owe, kind: "money", tone: "pos" },
          { label: "Advances held", value: adv, kind: "money", tone: "neg" },
          { label: "Customers owing", value: out.filter((x) => x.balance > 0).length, kind: "number" },
        ],
        note: `Overdue means no payment for more than ${settings.creditPeriodDays} days (configurable in Settings).`,
      };
    }

    case "supplier-payable": {
      const { rows } = await listSuppliers(db, actor, { sort: "balance", limit: 10000, q: opts.q });
      const out = rows.filter((x) => x.balance !== 0).map((x) => ({ code: x.code, name: x.name, mobile: x.mobile, gstin: x.gstin, purchased: x.purchased, paid: x.paid, balance: x.balance, status: x.balance > 0 ? "We owe" : "Advance paid", lastTxn: x.lastTxn ? formatDate(x.lastTxn) : "—" }));
      return {
        ...base,
        columns: [C("code", "ID"), C("name", "Supplier"), C("mobile", "Mobile"), C("gstin", "GSTIN"), C("purchased", "Purchases", "money"), C("paid", "Paid", "money"), C("balance", "Balance", "money"), C("status", "Status"), C("lastTxn", "Last activity")],
        rows: out,
        summary: [
          { label: "Total payable", value: out.filter((x) => x.balance > 0).reduce((a, x) => a + x.balance, 0), kind: "money", tone: "neg" },
          { label: "Advances paid", value: out.filter((x) => x.balance < 0).reduce((a, x) => a - x.balance, 0), kind: "money" },
        ],
      };
    }

    case "customer-statement":
    case "supplier-statement": {
      const partyType = key === "customer-statement" ? "CUSTOMER" : "SUPPLIER";
      if (!opts.partyId) return { ...base, columns: [], rows: [], note: `Select a ${partyType === "CUSTOMER" ? "customer" : "supplier"} to view the statement.` };
      const st = await partyStatement(db, actor, { type: partyType, id: opts.partyId }, r);
      const incLabel = partyType === "CUSTOMER" ? "Debit (gave)" : "Credit (bill)";
      const decLabel = partyType === "CUSTOMER" ? "Credit (got)" : "Debit (paid)";
      const rows: ReportRow[] = [
        { date: formatDate(r.from), txnNo: "", description: "Opening balance", method: "", inc: null, dec: null, balance: st.opening },
        ...st.rows.map((x) => ({
          date: formatDate(x.txnDate),
          txnNo: x.txnNo,
          description: x.description + (x.status === "REVERSED" ? " (reversed)" : ""),
          method: x.paymentMethod ? PAYMENT_METHOD_LABEL[x.paymentMethod as PaymentMethod] : "",
          inc: x.effectP > 0 ? x.effectP : null,
          dec: x.effectP < 0 ? -x.effectP : null,
          balance: x.running,
        })),
      ];
      return {
        ...base,
        title: `${def.title} — ${st.party.name}`,
        columns: [C("date", "Date"), C("txnNo", "Txn ID"), C("description", "Description"), C("method", "Mode"), C("inc", incLabel, "money"), C("dec", decLabel, "money"), C("balance", "Balance", "money")],
        rows,
        totals: { date: "Closing", inc: st.increases, dec: st.decreases, balance: st.closing },
        summary: [
          { label: "Opening", value: st.opening, kind: "money" },
          { label: partyType === "CUSTOMER" ? "Total given" : "Total purchases", value: st.increases, kind: "money" },
          { label: partyType === "CUSTOMER" ? "Total received" : "Total paid", value: st.decreases, kind: "money" },
          { label: partyType === "CUSTOMER" ? (st.closing >= 0 ? "Customer owes" : "We owe customer") : st.closing >= 0 ? "We owe supplier" : "Supplier owes us", value: Math.abs(st.closing), kind: "money", tone: "pos" },
        ],
        note: partyType === "CUSTOMER" ? "Positive balance = amount receivable from the customer." : "Positive balance = amount payable to the supplier.",
      };
    }

    case "payment-collection": {
      const rows = await db
        .select({ p: s.payments, partyName: sql<string>`coalesce(${s.customers.name}, 'Walk-in customer')`, by: s.users.name })
        .from(s.payments)
        .leftJoin(s.customers, and(eq(s.payments.partyType, "CUSTOMER"), eq(s.customers.id, s.payments.partyId)))
        .leftJoin(s.users, eq(s.users.id, s.payments.createdBy))
        .where(and(eq(s.payments.direction, "IN"), eq(s.payments.status, "ACTIVE"), sql`(${s.payments.partyType} is null or ${s.payments.partyType} = 'CUSTOMER')`, gte(s.payments.paymentDate, r.from), lte(s.payments.paymentDate, r.to)))
        .orderBy(s.payments.paymentDate, s.payments.createdAt);
      const out = rows.map((x) => ({ date: formatDate(x.p.paymentDate), receipt: x.p.paymentNo, party: x.partyName, method: PAYMENT_METHOD_LABEL[x.p.method], reference: x.p.referenceNo, by: x.by, amount: toPaise(x.p.amount) }));
      const byMethod = new Map<string, number>();
      for (const x of out) byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + x.amount);
      return {
        ...base,
        columns: [C("date", "Date"), C("receipt", "Receipt no."), C("party", "Received from"), C("method", "Method"), C("reference", "Reference"), C("by", "Recorded by"), C("amount", "Amount", "money")],
        rows: out,
        totals: { date: "Total", amount: out.reduce((a, x) => a + x.amount, 0) },
        summary: [...byMethod.entries()].map(([label, value]) => ({ label, value, kind: "money" as const })),
        note: "Collections are money received. They reduce receivables; they are not new revenue.",
      };
    }

    case "expense-report": {
      const rows = await db
        .select()
        .from(s.expenses)
        .where(and(eq(s.expenses.status, "ACTIVE"), gte(s.expenses.expenseDate, r.from), lte(s.expenses.expenseDate, r.to)))
        .orderBy(s.expenses.expenseDate);
      const out = rows.map((e) => ({ date: formatDate(e.expenseDate), no: e.expenseNo, category: e.category, payee: e.payee, description: e.description, method: PAYMENT_METHOD_LABEL[e.paymentMethod], amount: toPaise(e.amount) }));
      const byCat = new Map<string, number>();
      for (const x of out) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount);
      return {
        ...base,
        columns: [C("date", "Date"), C("no", "Expense no."), C("category", "Category"), C("payee", "Paid to"), C("description", "Description"), C("method", "Method"), C("amount", "Amount", "money")],
        rows: out,
        totals: { date: "Total", amount: out.reduce((a, x) => a + x.amount, 0) },
        summary: [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, kind: "money" as const })),
      };
    }

    case "profit-estimate": {
      const codes = [ACC.SALES, ACC.SALES_RETURNS, ACC.OTHER_INCOME, ACC.ROUND_OFF, ACC.COGS, ACC.STOCK_ADJUST, ACC.DISCOUNTS_WRITEOFF, ...EXPENSE_CODES];
      const m = await glMovement(db, codes, r);
      const inc = (c: string) => -(m.get(c) ?? 0);
      const exp = (c: string) => m.get(c) ?? 0;
      const sales = inc(ACC.SALES);
      const returns = exp(ACC.SALES_RETURNS);
      const netRev = sales - returns;
      const cogs = exp(ACC.COGS);
      const gross = netRev - cogs;
      const lines: ReportRow[] = [
        { item: "Sales (excl. GST)", amount: sales, section: "Revenue" },
        { item: "Less: sales returns", amount: -returns, section: "Revenue" },
        { item: "Net revenue", amount: netRev, section: "Revenue", bold: 1 },
        { item: "Less: cost of goods sold", amount: -cogs, section: "Cost" },
        { item: "Gross profit", amount: gross, section: "Cost", bold: 1 },
      ];
      let opex = 0;
      for (const c of EXPENSE_CATEGORIES) {
        const v = exp(c.code);
        opex += v;
        if (v) lines.push({ item: `Less: ${c.key}`, amount: -v, section: "Expenses" });
      }
      const adj = exp(ACC.STOCK_ADJUST);
      const disc = exp(ACC.DISCOUNTS_WRITEOFF);
      const other = inc(ACC.OTHER_INCOME) + inc(ACC.ROUND_OFF);
      if (adj) lines.push({ item: "Less: stock adjustments (loss/gain)", amount: -adj, section: "Other" });
      if (disc) lines.push({ item: "Less: discounts & write-offs", amount: -disc, section: "Other" });
      if (other) lines.push({ item: "Add: other income & round-off", amount: other, section: "Other" });
      const net = gross - opex - adj - disc + other;
      lines.push({ item: "Estimated net profit", amount: net, section: "Result", bold: 1 });
      return {
        ...base,
        columns: [C("section", "Section"), C("item", "Item"), C("amount", "Amount", "money")],
        rows: lines,
        summary: [
          { label: "Net revenue", value: netRev, kind: "money" },
          { label: "Gross profit", value: gross, kind: "money", tone: gross >= 0 ? "pos" : "neg" },
          { label: "Expenses", value: opex, kind: "money" },
          { label: "Net profit (est.)", value: net, kind: "money", tone: net >= 0 ? "pos" : "neg" },
        ],
        note: "Estimate from recorded data. Khata 'goods given' entries without itemised bills count as revenue with no cost. Not a substitute for audited accounts.",
      };
    }

    case "cash-flow": {
      const rows = await db
        .select({
          source: s.journalEntries.sourceType,
          code: s.ledgerAccounts.code,
          inflow: sql<string>`coalesce(sum(${s.journalEntryLines.debit}), 0)`,
          outflow: sql<string>`coalesce(sum(${s.journalEntryLines.credit}), 0)`,
        })
        .from(s.journalEntryLines)
        .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.journalEntryLines.accountId))
        .innerJoin(s.journalEntries, eq(s.journalEntries.id, s.journalEntryLines.journalEntryId))
        .where(and(inArray(s.ledgerAccounts.code, MONEY_ACCOUNT_CODES), gte(s.journalEntries.entryDate, r.from), lte(s.journalEntries.entryDate, r.to)))
        .groupBy(s.journalEntries.sourceType, s.ledgerAccounts.code);
      const label: Record<string, string> = { MONEY: "Owner capital, drawings & transfers", PAYMENT: "Payments (customers & suppliers)", SALE: "Walk-in cash sales", SALE_RETURN: "Walk-in refunds", EXPENSE: "Expenses", LEDGER: "Khata entries", OPENING: "Opening balances", STOCK: "Stock", PURCHASE: "Purchases" };
      const acct: Record<string, string> = { "1000": "Cash", "1010": "Bank", "1020": "UPI", "1030": "Other" };
      const out = rows.map((x) => ({ source: label[x.source] ?? x.source, account: acct[x.code], inflow: toPaise(x.inflow), outflow: toPaise(x.outflow), net: toPaise(x.inflow) - toPaise(x.outflow) }));
      const openingMap = await glMovement(db, MONEY_ACCOUNT_CODES, { to: addDays(r.from, -1) });
      const opening = [...openingMap.values()].reduce((a, b) => a + b, 0);
      const inflow = out.reduce((a, x) => a + x.inflow, 0);
      const outflow = out.reduce((a, x) => a + x.outflow, 0);
      return {
        ...base,
        columns: [C("source", "Activity"), C("account", "Account"), C("inflow", "Money in", "money"), C("outflow", "Money out", "money"), C("net", "Net", "money")],
        rows: out,
        totals: { source: "Total", inflow, outflow, net: inflow - outflow },
        summary: [
          { label: "Opening cash & bank", value: opening, kind: "money" },
          { label: "Money in", value: inflow, kind: "money", tone: "pos" },
          { label: "Money out", value: outflow, kind: "money", tone: "neg" },
          { label: "Closing cash & bank", value: opening + inflow - outflow, kind: "money" },
        ],
        note: "Includes reversals on the date they were recorded. Credit sales do not affect cash until collected.",
      };
    }

    case "gst-summary": {
      const [out] = await db
        .select({ taxable: sql<string>`coalesce(sum(${s.sales.taxableTotal}), 0)`, cgst: sql<string>`coalesce(sum(${s.sales.cgstTotal}), 0)`, sgst: sql<string>`coalesce(sum(${s.sales.sgstTotal}), 0)`, igst: sql<string>`coalesce(sum(${s.sales.igstTotal}), 0)` })
        .from(s.sales)
        .where(and(eq(s.sales.status, "ACTIVE"), gte(s.sales.saleDate, r.from), lte(s.sales.saleDate, r.to)));
      const [ret] = await db
        .select({ tax: sql<string>`coalesce(sum(${s.saleReturns.taxTotal}), 0)`, taxable: sql<string>`coalesce(sum(${s.saleReturns.taxableTotal}), 0)` })
        .from(s.saleReturns)
        .where(and(gte(s.saleReturns.returnDate, r.from), lte(s.saleReturns.returnDate, r.to)));
      const [inp] = await db
        .select({ taxable: sql<string>`coalesce(sum(${s.purchases.taxableTotal}), 0)`, cgst: sql<string>`coalesce(sum(${s.purchases.cgstTotal}), 0)`, sgst: sql<string>`coalesce(sum(${s.purchases.sgstTotal}), 0)`, igst: sql<string>`coalesce(sum(${s.purchases.igstTotal}), 0)` })
        .from(s.purchases)
        .where(and(eq(s.purchases.status, "ACTIVE"), gte(s.purchases.purchaseDate, r.from), lte(s.purchases.purchaseDate, r.to)));
      const itc = settings.gstRegistered && settings.gstScheme === "REGULAR";
      const row = (label: string, x: { taxable: string; cgst: string; sgst: string; igst: string }, sign = 1) => ({
        item: label,
        taxable: sign * toPaise(x.taxable),
        cgst: sign * toPaise(x.cgst),
        sgst: sign * toPaise(x.sgst),
        igst: sign * toPaise(x.igst),
        total: sign * (toPaise(x.cgst) + toPaise(x.sgst) + toPaise(x.igst)),
      });
      const outputTax = toPaise(out.cgst) + toPaise(out.sgst) + toPaise(out.igst) - toPaise(ret.tax);
      const inputTax = itc ? toPaise(inp.cgst) + toPaise(inp.sgst) + toPaise(inp.igst) : 0;
      return {
        ...base,
        columns: [C("item", "Item"), C("taxable", "Taxable value", "money"), C("cgst", "CGST", "money"), C("sgst", "SGST", "money"), C("igst", "IGST", "money"), C("total", "Total tax", "money")],
        rows: [
          row("Outward supplies (sales)", out),
          { item: "Less: credit notes (returns)", taxable: -toPaise(ret.taxable), cgst: null, sgst: null, igst: null, total: -toPaise(ret.tax) },
          row(itc ? "Inward supplies (input tax credit)" : "Inward supplies (ITC not claimable)", inp),
        ],
        summary: [
          { label: "Output tax", value: outputTax, kind: "money" },
          { label: "Input tax credit", value: inputTax, kind: "money" },
          { label: "Net GST payable (est.)", value: outputTax - inputTax, kind: "money", tone: "neg" },
        ],
        note: settings.gstRegistered ? "Summary for reference; file returns from your GST portal records." : "Business is not GST registered (Settings → GST). No tax is charged on invoices.",
      };
    }

    case "inventory-valuation": {
      const { rows, totalValue } = await listProducts(db, actor, { limit: 10000, q: opts.q });
      const out = rows.map((p) => ({ code: p.code, name: p.name, category: p.category, unit: p.unit, qty: p.qtyMilli, avgCost: toPaise(p.avgCost), value: p.valueP, sellingPrice: toPaise(p.sellingPrice), retail: Math.max(0, Math.round((p.qtyMilli * toPaise(p.sellingPrice)) / 1000)), status: p.qtyMilli <= 0 ? "Out of stock" : p.isLow ? "Low" : "OK" }));
      return {
        ...base,
        columns: [C("code", "ID"), C("name", "Product"), C("category", "Category"), C("unit", "Unit"), C("qty", "Stock", "qty"), C("avgCost", "Avg cost", "money"), C("value", "Value at cost", "money"), C("sellingPrice", "Selling price", "money"), C("retail", "Value at MRP", "money"), C("status", "Status")],
        rows: out,
        totals: { code: "Total", value: totalValue, retail: out.reduce((a, x) => a + x.retail, 0) },
        summary: [
          { label: "Inventory value (cost)", value: totalValue, kind: "money" },
          { label: "Products", value: out.length, kind: "number" },
          { label: "Low / out of stock", value: out.filter((x) => x.status !== "OK").length, kind: "number" },
        ],
      };
    }

    case "stock-movement": {
      const rows = await db
        .select({ m: s.inventoryMovements, product: s.products.name, unit: s.products.unit, by: s.users.name })
        .from(s.inventoryMovements)
        .innerJoin(s.products, eq(s.products.id, s.inventoryMovements.productId))
        .leftJoin(s.users, eq(s.users.id, s.inventoryMovements.createdBy))
        .where(and(gte(s.inventoryMovements.movementDate, r.from), lte(s.inventoryMovements.movementDate, r.to), opts.q ? sql`${s.products.name} ilike ${"%" + opts.q + "%"}` : undefined))
        .orderBy(s.inventoryMovements.createdAt);
      const out = rows.map((x) => {
        const q = toMilli(x.m.quantity);
        return { date: formatDate(x.m.movementDate), product: x.product, type: x.m.type.replace(/_/g, " ").toLowerCase(), inQty: q > 0 ? q : null, outQty: q < 0 ? -q : null, balance: toMilli(x.m.balanceAfter), unitCost: toPaise(x.m.unitCost), reason: (x.m.reason ?? "").replace(/\s\[[^\]]+\]$/, ""), by: x.by };
      });
      return {
        ...base,
        columns: [C("date", "Date"), C("product", "Product"), C("type", "Movement"), C("inQty", "In", "qty"), C("outQty", "Out", "qty"), C("balance", "Balance", "qty"), C("unitCost", "Unit cost", "money"), C("reason", "Reason / reference"), C("by", "By")],
        rows: out,
      };
    }

    case "trial-balance": {
      const accts = await db.select().from(s.ledgerAccounts).orderBy(s.ledgerAccounts.code);
      const m = await glMovement(db, accts.map((a) => a.code), {});
      const out = accts.map((a) => {
        const net = m.get(a.code) ?? 0;
        return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : null, credit: net < 0 ? -net : null };
      }).filter((x) => x.debit || x.credit);
      const dr = out.reduce((a, x) => a + (x.debit ?? 0), 0);
      const cr = out.reduce((a, x) => a + (x.credit ?? 0), 0);
      const mismatch = await db.execute(sql`
        with j as (
          select l.party_type, l.party_id, sum(case when l.party_type = 'CUSTOMER' then l.debit - l.credit else l.credit - l.debit end) as bal
          from journal_entry_lines l join ledger_accounts a on a.id = l.account_id where a.code in ('1100','2000') group by 1,2
        ), k as (select party_type, party_id, sum(balance_effect) as bal from ledger_transactions group by 1,2)
        select count(*)::int as n from j full outer join k on j.party_type = k.party_type and j.party_id = k.party_id
        where coalesce(j.bal,0) <> coalesce(k.bal,0)`);
      const mm = Number(((mismatch as unknown as { rows?: { n: number }[] }).rows ?? (mismatch as unknown as { n: number }[]))[0]?.n ?? 0);
      const invGL = m.get(ACC.INVENTORY) ?? 0;
      const inv = await inventorySummary(db);
      return {
        ...base,
        columns: [C("code", "Code"), C("name", "Account"), C("type", "Type"), C("debit", "Debit", "money"), C("credit", "Credit", "money")],
        rows: out,
        totals: { code: "Total", debit: dr, credit: cr },
        summary: [
          { label: dr === cr ? "Ledger balanced (debits = credits)" : "LEDGER OUT OF BALANCE", value: dr - cr, kind: "money", tone: dr === cr ? "pos" : "neg" },
          { label: mm === 0 ? "Party ledgers match control accounts" : "Party ledger mismatches", value: mm, kind: "number", tone: mm === 0 ? "pos" : "neg" },
          { label: "Inventory: ledger − stock valuation", value: invGL - inv.value, kind: "money" },
        ],
        note: "Debits must equal credits. Each customer/supplier khata must equal its control-account balance. A small inventory difference can arise from average-cost rounding or negative stock.",
      };
    }
  }
}

export function defaultReportRange(key: ReportKey, today = todayIST()): Range {
  if (key === "monthly-sales") return financialYearRange(today);
  return { from: startOfMonth(today), to: today };
}
