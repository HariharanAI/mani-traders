import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { setupDb, key, trialBalance, subledgerMismatches } from "./helpers";
import { createCustomer, createSupplier, partySummary, listCustomers, deleteCustomer, archiveCustomer, customerTotals, listSuppliers } from "@/server/services/parties";
import { addKhataEntry, reverseKhataEntry, partyStatement } from "@/server/services/khata";
import { recordPayment, reversePayment } from "@/server/services/payments";
import { createProduct, adjustStock, getProduct } from "@/server/services/inventory";
import { createPurchase, cancelPurchase } from "@/server/services/purchases";
import { createSale, cancelSale, createSaleReturn, getSale } from "@/server/services/sales";
import { createExpense, updateExpense, voidExpense } from "@/server/services/expenses";
import { partyBalance } from "@/server/core";
import { addCashEntry, moneyBalances } from "@/server/services/cashbook";
import type { DB } from "@/server/db/client";
import type { Actor } from "@/server/core";
import { toMilli, toPaise } from "@/lib/money";

let db: DB;
let actor: Actor;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, actor, close } = await setupDb());
});
afterAll(async () => {
  await close();
});

async function assertBooksBalance() {
  const tb = await trialBalance(db);
  expect(tb.total).toBe(0);
  expect(await subledgerMismatches(db)).toEqual([]);
}

describe("customer khata", () => {
  it("reproduces the Ravi Kumar example: 5,000 − 2,000 + 3,000 = 6,000 outstanding", async () => {
    const ravi = await createCustomer(db, actor, { name: "Ravi Kumar", mobile: "9876543210", openingBalance: "0" });
    const party = { type: "CUSTOMER" as const, id: ravi.id };
    await addKhataEntry(db, actor, { partyType: "CUSTOMER", partyId: ravi.id, kind: "GAVE_GOODS", amount: "5000", date: "2026-11-01", description: "Goods purchased", idempotencyKey: key() });
    await addKhataEntry(db, actor, { partyType: "CUSTOMER", partyId: ravi.id, kind: "GOT_MONEY", amount: "2000", date: "2026-11-02", paymentMethod: "UPI", idempotencyKey: key() });
    await addKhataEntry(db, actor, { partyType: "CUSTOMER", partyId: ravi.id, kind: "GAVE_GOODS", amount: "3000", date: "2026-11-04", idempotencyKey: key() });
    const sum = await partySummary(db, party);
    expect(sum.given).toBe(800000);
    expect(sum.received).toBe(200000);
    expect(sum.balance).toBe(600000);
    expect(await partyBalance(db, party)).toBe(600000);
    // list + totals queries (correlated subqueries) must agree with the journal
    const list = await listCustomers(db, actor, { q: "Ravi" });
    expect(list.rows[0]).toMatchObject({ given: 800000, received: 200000, balance: 600000 });
    const totals = await customerTotals(db, actor);
    expect(totals.receivable).toBe(600000);
    expect(totals.owing).toBe(1);
    const st = await partyStatement(db, actor, party);
    expect(st.rows.map((r) => r.running)).toEqual([500000, 300000, 600000]);
    await assertBooksBalance();
  });

  it("posts opening balances to the ledger and supports changing them by reversal", async () => {
    const c = await createCustomer(db, actor, { name: "Opening Test", openingBalance: "1500" });
    expect(await partyBalance(db, { type: "CUSTOMER", id: c.id })).toBe(150000);
    const adv = await createCustomer(db, actor, { name: "Advance Test", openingBalance: "-250.50" });
    expect(await partyBalance(db, { type: "CUSTOMER", id: adv.id })).toBe(-25050);
    await assertBooksBalance();
  });

  it("prevents duplicate payment submissions", async () => {
    const c = await createCustomer(db, actor, { name: "Dup Test", openingBalance: "1000" });
    const k = key();
    const input = { direction: "IN" as const, partyType: "CUSTOMER" as const, partyId: c.id, amount: "400", method: "CASH" as const, date: "2026-11-05", idempotencyKey: k };
    const a = await recordPayment(db, actor, input);
    const b = await recordPayment(db, actor, input);
    expect(b.duplicate).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(await partyBalance(db, { type: "CUSTOMER", id: c.id })).toBe(60000);
    expect(a.payment.balanceAfter).toBe("600.00");
  });

  it("reverses entries instead of deleting them", async () => {
    const c = await createCustomer(db, actor, { name: "Reverse Test", openingBalance: "0" });
    const party = { type: "CUSTOMER" as const, id: c.id };
    const { entry } = await addKhataEntry(db, actor, { partyType: "CUSTOMER", partyId: c.id, kind: "GAVE_GOODS", amount: "999", date: "2026-11-05", idempotencyKey: key() });
    const pay = await recordPayment(db, actor, { direction: "IN", partyType: "CUSTOMER", partyId: c.id, amount: "500", method: "UPI", date: "2026-11-05", idempotencyKey: key() });
    expect(await partyBalance(db, party)).toBe(49900);
    await reversePayment(db, actor, pay.payment.id, "Bounced UPI");
    expect(await partyBalance(db, party)).toBe(99900);
    await expect(reversePayment(db, actor, pay.payment.id, "again")).rejects.toThrow(/already/);
    await reverseKhataEntry(db, actor, entry.id, "Wrong customer");
    expect(await partyBalance(db, party)).toBe(0);
    const st = await partyStatement(db, actor, party);
    expect(st.rows).toHaveLength(4); // 2 originals + 2 reversals, history kept
    expect(st.rows.filter((r) => r.status === "REVERSED")).toHaveLength(2);
    // customer with history cannot be deleted, only archived
    await expect(deleteCustomer(db, actor, c.id)).rejects.toThrow(/Archive/);
    await archiveCustomer(db, actor, c.id, true);
    const list = await listCustomers(db, actor, { q: "Reverse Test" });
    expect(list.rows).toHaveLength(0);
    await assertBooksBalance();
  });

  it("database rejects edits/deletes of journal history", async () => {
    await expect(db.execute(sql`delete from journal_entry_lines`)).rejects.toThrow();
    await expect(db.execute(sql`update journal_entry_lines set debit = debit + 1`)).rejects.toThrow();
    await expect(db.execute(sql`delete from ledger_transactions`)).rejects.toThrow();
  });
});

describe("purchases, sales, inventory", () => {
  it("runs a full GST purchase → sale → return → cancel cycle with consistent books", async () => {
    // Make the business GST registered (Tamil Nadu)
    await db.update(s.businessSettings).set({ gstRegistered: true, gstScheme: "REGULAR", stateCode: "33", gstin: "33AAAAA0000A1Z5" }).where(eq(s.businessSettings.id, 1));
    const rice = await createProduct(db, actor, { name: "Rice 25kg", unit: "bag", purchasePrice: "1000", sellingPrice: "1300", gstRate: "5", minStock: "2", openingStock: "0" });
    const supplier = await createSupplier(db, actor, { name: "Agro Wholesale", stateCode: "33", openingBalance: "0" });

    // Purchase 10 bags @1000 + 5% GST = 10,500; pay 4,000
    const { purchase } = await createPurchase(db, actor, {
      supplierId: supplier.id,
      date: "2026-11-05",
      taxMode: "EXCLUSIVE",
      lines: [{ productId: rice.id, description: "Rice 25kg", quantity: "10", rate: "1000", gstRate: "5" }],
      amountPaid: "4000",
      paymentMethod: "BANK",
      idempotencyKey: key(),
    });
    expect(purchase.grandTotal).toBe("10500.00");
    expect(await partyBalance(db, { type: "SUPPLIER", id: supplier.id })).toBe(650000);
    let p = await getProduct(db, actor, rice.id);
    expect(toMilli(p.stockQty)).toBe(10000);
    expect(p.avgCost).toBe("1000.00"); // ITC claimed → cost excludes GST

    // Credit sale of 3 bags @1300 + 5% = 4,095 ; receive 1,000
    const cust = await createCustomer(db, actor, { name: "Lakshmi Stores", stateCode: "33", openingBalance: "0" });
    const { sale } = await createSale(db, actor, {
      customerId: cust.id,
      date: "2026-11-06",
      lines: [{ productId: rice.id, description: "Rice 25kg", quantity: "3", rate: "1300", gstRate: "5" }],
      amountReceived: "1000",
      paymentMethod: "CASH",
      idempotencyKey: key(),
    });
    expect(sale.cgstTotal).toBe("97.50");
    expect(sale.sgstTotal).toBe("97.50");
    expect(sale.grandTotal).toBe("4095.00");
    expect(sale.costTotal).toBe("3000.00");
    expect(await partyBalance(db, { type: "CUSTOMER", id: cust.id })).toBe(309500);
    p = await getProduct(db, actor, rice.id);
    expect(toMilli(p.stockQty)).toBe(7000);
    const full = await getSale(db, actor, sale.id);
    expect(full.due).toBe(309500);
    await assertBooksBalance();

    // Overselling is blocked
    await expect(
      createSale(db, actor, { customerId: cust.id, date: "2026-11-06", lines: [{ productId: rice.id, description: "Rice", quantity: "50", rate: "1300", gstRate: "5" }], amountReceived: "0", idempotencyKey: key() }),
    ).rejects.toThrow(/Not enough stock/);

    // Return 1 bag → credit note 1,365 ; no refund
    await createSaleReturn(db, actor, { saleId: sale.id, date: "2026-11-07", items: [{ saleItemId: full.items[0].id, quantity: "1" }], refundAmount: "0", reason: "Damaged bag", idempotencyKey: key() });
    expect(await partyBalance(db, { type: "CUSTOMER", id: cust.id })).toBe(309500 - 136500);
    p = await getProduct(db, actor, rice.id);
    expect(toMilli(p.stockQty)).toBe(8000);
    await expect(cancelSale(db, actor, { id: sale.id, reason: "test" })).rejects.toThrow(/returns/);
    await assertBooksBalance();

    // Second sale then cancel it with refund of payment → balance and stock restored
    const before = await partyBalance(db, { type: "CUSTOMER", id: cust.id });
    const { sale: s2 } = await createSale(db, actor, { customerId: cust.id, date: "2026-11-07", lines: [{ productId: rice.id, description: "Rice", quantity: "2", rate: "1300", gstRate: "5" }], amountReceived: "500", paymentMethod: "UPI", idempotencyKey: key() });
    await cancelSale(db, actor, { id: s2.id, reason: "Customer changed mind", reversePayments: true });
    expect(await partyBalance(db, { type: "CUSTOMER", id: cust.id })).toBe(before);
    p = await getProduct(db, actor, rice.id);
    expect(toMilli(p.stockQty)).toBe(8000);

    // Walk-in cash sale must be fully paid
    await expect(
      createSale(db, actor, { date: "2026-11-07", lines: [{ productId: rice.id, description: "Rice", quantity: "1", rate: "1300", gstRate: "5" }], amountReceived: "100", idempotencyKey: key() }),
    ).rejects.toThrow(/fully paid/);
    const { sale: walk } = await createSale(db, actor, { date: "2026-11-07", walkInName: "Cash customer", lines: [{ productId: rice.id, description: "Rice", quantity: "1", rate: "1300", gstRate: "5" }], amountReceived: "1365", paymentMethod: "CASH", idempotencyKey: key() });
    expect(walk.grandTotal).toBe("1365.00");
    await cancelSale(db, actor, { id: walk.id, reason: "test cancel" });

    // Cancelling the 10-bag purchase with only 8 in stock would make stock negative → blocked, nothing changes
    await expect(cancelPurchase(db, actor, { id: purchase.id, reason: "Wrong bill", reversePayments: true })).rejects.toThrow(/Not enough stock/);
    expect(await partyBalance(db, { type: "SUPPLIER", id: supplier.id })).toBe(650000);

    // A fresh purchase can be cancelled cleanly: payable and stock return to where they were
    const { purchase: p2 } = await createPurchase(db, actor, { supplierId: supplier.id, date: "2026-11-07", taxMode: "EXCLUSIVE", lines: [{ productId: rice.id, description: "Rice", quantity: "4", rate: "1000", gstRate: "5" }], amountPaid: "1000", paymentMethod: "CASH", idempotencyKey: key() });
    await cancelPurchase(db, actor, { id: p2.id, reason: "Wrong bill", reversePayments: true });
    expect(await partyBalance(db, { type: "SUPPLIER", id: supplier.id })).toBe(650000);
    p = await getProduct(db, actor, rice.id);
    expect(toMilli(p.stockQty)).toBe(8000);
    await assertBooksBalance();
  }, 120000);
});

describe("stock & expenses", () => {
  it("adjusts stock with reasons and keeps inventory in the ledger", async () => {
    const oil = await createProduct(db, actor, { name: "Oil 1L", purchasePrice: "150", sellingPrice: "180", openingStock: "20", minStock: "5" });
    await adjustStock(db, actor, { productId: oil.id, kind: "STOCK_OUT", quantity: "2", date: "2026-11-07", reason: "Leakage", idempotencyKey: key() });
    await adjustStock(db, actor, { productId: oil.id, kind: "SET", quantity: "15", date: "2026-11-07", reason: "Physical count", idempotencyKey: key() });
    const p = await getProduct(db, actor, oil.id);
    expect(toMilli(p.stockQty)).toBe(15000);
    await expect(adjustStock(db, actor, { productId: oil.id, kind: "STOCK_OUT", quantity: "100", date: "2026-11-07", reason: "Too much", idempotencyKey: key() })).rejects.toThrow(/Not enough stock/);
    await assertBooksBalance();
  });

  it("records, edits (re-posts) and voids expenses without touching receivables", async () => {
    const tbBefore = await trialBalance(db);
    const { expense } = await createExpense(db, actor, { date: "2026-11-07", category: "Rent", amount: "12000", paymentMethod: "BANK", idempotencyKey: key() });
    await updateExpense(db, actor, expense.id, { date: "2026-11-07", category: "Electricity", amount: "2500", paymentMethod: "CASH", idempotencyKey: key() });
    let tb = await trialBalance(db);
    expect((tb.map.get("6002") ?? 0) - (tbBefore.map.get("6002") ?? 0)).toBe(250000);
    expect((tb.map.get("6001") ?? 0) - (tbBefore.map.get("6001") ?? 0)).toBe(0);
    expect(tb.map.get("1100")).toBe(tbBefore.map.get("1100"));
    await voidExpense(db, actor, expense.id, "Entered by mistake");
    tb = await trialBalance(db);
    expect((tb.map.get("6002") ?? 0) - (tbBefore.map.get("6002") ?? 0)).toBe(0);
    await assertBooksBalance();
  });
});

describe("cash & bank", () => {
  it("records opening cash, capital, drawings and transfers", async () => {
    const before = new Map((await moneyBalances(db)).map((b) => [b.code, b.balance]));
    await addCashEntry(db, actor, { kind: "OPENING", account: "CASH", amount: "10000", date: "2026-11-01" });
    await addCashEntry(db, actor, { kind: "TRANSFER", account: "CASH", toAccount: "BANK", amount: "4000", date: "2026-11-02" });
    await addCashEntry(db, actor, { kind: "DRAWINGS", account: "BANK", amount: "500", date: "2026-11-03" });
    const after = new Map((await moneyBalances(db)).map((b) => [b.code, b.balance]));
    expect(after.get("1000")! - before.get("1000")!).toBe(600000);
    expect(after.get("1010")! - before.get("1010")!).toBe(350000);
    await expect(addCashEntry(db, actor, { kind: "TRANSFER", account: "CASH", toAccount: "CASH", amount: "1", date: "2026-11-03" })).rejects.toThrow(/same/);
    await assertBooksBalance();
  });
});

describe("money totals use exact numerics", () => {
  it("sums many small amounts without drift", async () => {
    const c = await createCustomer(db, actor, { name: "Drift Test", openingBalance: "0" });
    for (let i = 0; i < 30; i++) {
      await addKhataEntry(db, actor, { partyType: "CUSTOMER", partyId: c.id, kind: "GAVE_GOODS", amount: "0.10", date: "2026-11-07", idempotencyKey: key() });
    }
    expect(await partyBalance(db, { type: "CUSTOMER", id: c.id })).toBe(300);
    expect(toPaise("3.00")).toBe(300);
  });
});
