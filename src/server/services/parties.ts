/**
 * Customers & suppliers: master data, visibility scoping, balances and
 * opening balances (posted to the ledger, never stored as a bare number).
 */
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB, Executor, Tx } from "../db/client";
import * as s from "../db/schema";
import {
  AppError,
  assertCan,
  audit,
  can,
  insertLedgerTxn,
  nextCode,
  notFound,
  postJournal,
  reverseLedgerTxnRow,
  type Actor,
  type Party,
} from "../core";
import { ACC } from "@/lib/accounts";
import { customerSchema, supplierSchema, type CustomerInput, type SupplierInput } from "@/lib/validators";
import { toPaise, fromPaise, type Paise } from "@/lib/money";
import { todayIST } from "@/lib/dates";

// ---------------------------------------------------------------- visibility
/** Employees without customers.view_all only see customers assigned to them. */
export function customerScope(actor: Actor): SQL | undefined {
  if (can(actor, "customers.view_all")) return undefined;
  return eq(s.customers.assignedTo, actor.id);
}

export async function getCustomerForActor(db: Executor, actor: Actor, id: string) {
  assertCan(actor, "customers.view");
  const [c] = await db.select().from(s.customers).where(and(eq(s.customers.id, id), customerScope(actor)));
  if (!c) throw notFound("Customer");
  return c;
}

export async function getSupplier(db: Executor, actor: Actor, id: string) {
  assertCan(actor, "suppliers.view");
  const [sup] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, id));
  if (!sup) throw notFound("Supplier");
  return sup;
}

/** Ensures the actor may transact with this party. */
export async function assertPartyAccess(db: Executor, actor: Actor, party: Party) {
  if (party.type === "CUSTOMER") return getCustomerForActor(db, actor, party.id);
  return getSupplier(db, actor, party.id);
}

// ---------------------------------------------------------------- balance aggregates
// NOTE: correlated subqueries must reference the outer table explicitly. Drizzle renders bare
// column names ("id") when a query has a single table, which would bind to ledger_transactions.id.
const OUTER_ID = { CUSTOMER: sql.raw('"customers"."id"'), SUPPLIER: sql.raw('"suppliers"."id"') };
const ltAgg = (partyType: "CUSTOMER" | "SUPPLIER", partyIdCol: SQL) => ({
  given: sql<string>`coalesce((select sum(lt.balance_effect) from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol} and lt.status = 'ACTIVE' and lt.balance_effect > 0), 0)`,
  received: sql<string>`coalesce((select -sum(lt.balance_effect) from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol} and lt.status = 'ACTIVE' and lt.balance_effect < 0), 0)`,
  balance: sql<string>`coalesce((select sum(lt.balance_effect) from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol}), 0)`,
  lastTxn: sql<string | null>`(select max(lt.txn_date)::text from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol})`,
  lastPayment: sql<string | null>`(select max(lt.txn_date)::text from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol} and lt.status = 'ACTIVE' and lt.balance_effect < 0)`,
  firstTxn: sql<string | null>`(select min(lt.txn_date)::text from ledger_transactions lt where lt.party_type = ${partyType} and lt.party_id = ${partyIdCol} and lt.status = 'ACTIVE')`,
});

export type PartyListFilter = {
  q?: string;
  status?: "all" | "owes" | "advance" | "settled";
  category?: string;
  archived?: boolean;
  sort?: "name" | "balance" | "recent";
  limit?: number;
  offset?: number;
};

export async function listCustomers(db: Executor, actor: Actor, f: PartyListFilter = {}) {
  assertCan(actor, "customers.view");
  const agg = ltAgg("CUSTOMER", OUTER_ID.CUSTOMER);
  const q = f.q?.trim();
  const where = and(
    customerScope(actor),
    f.archived ? isNotNull(s.customers.archivedAt) : isNull(s.customers.archivedAt),
    f.category ? eq(s.customers.category, f.category) : undefined,
    q
      ? or(
          ilike(s.customers.name, `%${q}%`),
          ilike(s.customers.mobile, `%${q.replace(/\D/g, "") || q}%`),
          ilike(s.customers.code, `%${q}%`),
        )
      : undefined,
    f.status === "owes" ? sql`${agg.balance} > 0` : undefined,
    f.status === "advance" ? sql`${agg.balance} < 0` : undefined,
    f.status === "settled" ? sql`${agg.balance} = 0` : undefined,
  );
  const order =
    f.sort === "balance" ? [desc(agg.balance), asc(s.customers.name)] : f.sort === "recent" ? [sql`${agg.lastTxn} desc nulls last`, asc(s.customers.name)] : [asc(sql`lower(${s.customers.name})`)];
  const rows = await db
    .select({ c: s.customers, ...agg })
    .from(s.customers)
    .where(where)
    .orderBy(...order)
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(s.customers).where(where);
  return {
    total,
    rows: rows.map((r) => ({
      ...r.c,
      given: toPaise(r.given),
      received: toPaise(r.received),
      balance: toPaise(r.balance),
      lastTxn: r.lastTxn,
      lastPayment: r.lastPayment,
      firstTxn: r.firstTxn,
    })),
  };
}

export async function customerTotals(db: Executor, actor: Actor) {
  const agg = ltAgg("CUSTOMER", OUTER_ID.CUSTOMER);
  const sub = db
    .select({ balance: agg.balance.as("balance") })
    .from(s.customers)
    .where(and(customerScope(actor), isNull(s.customers.archivedAt)))
    .as("x");
  const [r] = await db
    .select({
      receivable: sql<string>`coalesce(sum(case when balance > 0 then balance end), 0)`,
      advance: sql<string>`coalesce(-sum(case when balance < 0 then balance end), 0)`,
      count: sql<number>`count(*)::int`,
      owing: sql<number>`count(*) filter (where balance > 0)::int`,
    })
    .from(sub);
  return { receivable: toPaise(r.receivable), advance: toPaise(r.advance), count: r.count, owing: r.owing };
}

export async function customerCategories(db: Executor): Promise<string[]> {
  const rows = await db.selectDistinct({ c: s.customers.category }).from(s.customers).orderBy(s.customers.category);
  return [...new Set(["Regular", "Wholesale", "Retail", ...rows.map((r) => r.c)])];
}

export async function listSuppliers(db: Executor, actor: Actor, f: PartyListFilter = {}) {
  assertCan(actor, "suppliers.view");
  const agg = ltAgg("SUPPLIER", OUTER_ID.SUPPLIER);
  const q = f.q?.trim();
  const where = and(
    f.archived ? isNotNull(s.suppliers.archivedAt) : isNull(s.suppliers.archivedAt),
    q ? or(ilike(s.suppliers.name, `%${q}%`), ilike(s.suppliers.mobile, `%${q}%`), ilike(s.suppliers.code, `%${q}%`), ilike(s.suppliers.gstin, `%${q}%`)) : undefined,
    f.status === "owes" ? sql`${agg.balance} > 0` : undefined,
    f.status === "advance" ? sql`${agg.balance} < 0` : undefined,
    f.status === "settled" ? sql`${agg.balance} = 0` : undefined,
  );
  const order = f.sort === "balance" ? [desc(agg.balance)] : f.sort === "recent" ? [sql`${agg.lastTxn} desc nulls last`] : [asc(sql`lower(${s.suppliers.name})`)];
  const rows = await db
    .select({ x: s.suppliers, ...agg })
    .from(s.suppliers)
    .where(where)
    .orderBy(...order)
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(s.suppliers).where(where);
  return {
    total,
    rows: rows.map((r) => ({ ...r.x, purchased: toPaise(r.given), paid: toPaise(r.received), balance: toPaise(r.balance), lastTxn: r.lastTxn })),
  };
}

export async function supplierTotals(db: Executor) {
  const agg = ltAgg("SUPPLIER", OUTER_ID.SUPPLIER);
  const sub = db.select({ balance: agg.balance.as("balance") }).from(s.suppliers).where(isNull(s.suppliers.archivedAt)).as("x");
  const [r] = await db
    .select({
      payable: sql<string>`coalesce(sum(case when balance > 0 then balance end), 0)`,
      advance: sql<string>`coalesce(-sum(case when balance < 0 then balance end), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(sub);
  return { payable: toPaise(r.payable), advance: toPaise(r.advance), count: r.count };
}

export async function partySummary(db: Executor, party: Party) {
  const agg = ltAgg(party.type, sql`${party.id}::uuid`);
  const [r] = await db.select(agg).from(sql`(select 1) as one`);
  return {
    given: toPaise(r.given),
    received: toPaise(r.received),
    balance: toPaise(r.balance),
    lastTxn: r.lastTxn,
    lastPayment: r.lastPayment,
  };
}

// ---------------------------------------------------------------- opening balance posting
async function postOpeningBalance(tx: Tx, actor: Actor, party: Party, amount: Paise, date: string) {
  if (amount === 0) return null;
  const abs = Math.abs(amount);
  const control = party.type === "CUSTOMER" ? ACC.RECEIVABLE : ACC.PAYABLE;
  // Customer: + means they owe us (debit AR). Supplier: + means we owe them (credit AP).
  const partyDebit = party.type === "CUSTOMER" ? amount > 0 : amount < 0;
  const je = await postJournal(tx, actor, {
    date,
    memo: `Opening balance`,
    sourceType: "OPENING",
    sourceId: party.id,
    lines: [
      { account: control, party, debit: partyDebit ? abs : 0, credit: partyDebit ? 0 : abs },
      { account: ACC.OPENING_EQUITY, debit: partyDebit ? 0 : abs, credit: partyDebit ? abs : 0 },
    ],
  });
  return insertLedgerTxn(tx, actor, {
    party,
    date,
    type: "OPENING_BALANCE",
    description: party.type === "CUSTOMER" ? (amount > 0 ? "Opening balance (customer owes)" : "Opening balance (advance from customer)") : amount > 0 ? "Opening balance (payable to supplier)" : "Opening balance (advance to supplier)",
    amount: abs,
    balanceEffect: amount,
    journalEntryId: je.id,
    sourceType: "OPENING",
    sourceId: party.id,
  });
}

/** Replaces the opening balance by reversing the active one (if any) and posting the new amount. */
async function changeOpeningBalance(tx: Tx, actor: Actor, party: Party, newAmount: Paise) {
  const [existing] = await tx
    .select()
    .from(s.ledgerTransactions)
    .where(
      and(
        eq(s.ledgerTransactions.partyType, party.type),
        eq(s.ledgerTransactions.partyId, party.id),
        eq(s.ledgerTransactions.type, "OPENING_BALANCE"),
        eq(s.ledgerTransactions.status, "ACTIVE"),
      ),
    );
  const current = existing ? toPaise(existing.balanceEffect) : 0;
  if (current === newAmount) return;
  const date = existing?.txnDate ?? todayIST();
  if (existing) await reverseLedgerTxnRow(tx, actor, existing.id, "Opening balance changed", todayIST());
  await postOpeningBalance(tx, actor, party, newAmount, date);
}

// ---------------------------------------------------------------- customers CRUD
export async function createCustomer(db: DB, actor: Actor, raw: CustomerInput) {
  assertCan(actor, "customers.manage");
  const input = customerSchema.parse(raw);
  if (input.assignedTo && !can(actor, "customers.view_all")) throw new AppError("You cannot assign customers to others.");
  return db.transaction(async (tx) => {
    if (input.mobile) {
      const [dup] = await tx.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(and(eq(s.customers.mobile, input.mobile), isNull(s.customers.archivedAt)));
      if (dup) throw new AppError(`Mobile number already used by ${dup.name}.`, { mobile: "Already in use" });
    }
    const code = await nextCode(tx, "customer");
    const opening = toPaise(input.openingBalance);
    const [c] = await tx
      .insert(s.customers)
      .values({
        code,
        name: input.name,
        mobile: input.mobile,
        whatsapp: input.whatsapp ?? input.mobile,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        stateCode: input.stateCode ?? (input.gstin ? input.gstin.slice(0, 2) : null),
        category: input.category,
        notes: input.notes,
        openingBalance: fromPaise(opening),
        // Employees who cannot see all customers own the customers they create.
        assignedTo: can(actor, "customers.view_all") ? (input.assignedTo ?? null) : actor.id,
        createdBy: actor.id,
      })
      .returning();
    await postOpeningBalance(tx, actor, { type: "CUSTOMER", id: c.id }, opening, todayIST());
    await audit(tx, actor, "CREATE", "customer", c.id, `Customer ${c.name} (${c.code}) created`, { after: c });
    return c;
  });
}

export async function updateCustomer(db: DB, actor: Actor, id: string, raw: CustomerInput) {
  assertCan(actor, "customers.manage");
  const input = customerSchema.parse(raw);
  return db.transaction(async (tx) => {
    const before = await getCustomerForActor(tx, actor, id);
    if (input.mobile && input.mobile !== before.mobile) {
      const [dup] = await tx.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(and(eq(s.customers.mobile, input.mobile), isNull(s.customers.archivedAt), sql`${s.customers.id} <> ${id}`));
      if (dup) throw new AppError(`Mobile number already used by ${dup.name}.`, { mobile: "Already in use" });
    }
    const opening = toPaise(input.openingBalance);
    const [after] = await tx
      .update(s.customers)
      .set({
        name: input.name,
        mobile: input.mobile,
        whatsapp: input.whatsapp ?? input.mobile,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        stateCode: input.stateCode ?? (input.gstin ? input.gstin.slice(0, 2) : null),
        category: input.category,
        notes: input.notes,
        openingBalance: fromPaise(opening),
        assignedTo: can(actor, "customers.view_all") ? (input.assignedTo ?? null) : before.assignedTo,
        updatedAt: new Date(),
      })
      .where(eq(s.customers.id, id))
      .returning();
    if (toPaise(before.openingBalance) !== opening) {
      assertCan(actor, "ledger.create");
      await changeOpeningBalance(tx, actor, { type: "CUSTOMER", id }, opening);
    }
    await audit(tx, actor, "UPDATE", "customer", id, `Customer ${after.name} updated`, { before, after });
    return after;
  });
}

/** Archive hides the customer; history is kept. Hard delete only when there is no history at all. */
export async function archiveCustomer(db: DB, actor: Actor, id: string, archive: boolean) {
  assertCan(actor, "customers.archive");
  return db.transaction(async (tx) => {
    const c = await getCustomerForActor(tx, actor, id);
    await tx.update(s.customers).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(eq(s.customers.id, id));
    await audit(tx, actor, archive ? "ARCHIVE" : "RESTORE", "customer", id, `Customer ${c.name} ${archive ? "archived" : "restored"}`);
  });
}

export async function deleteCustomer(db: DB, actor: Actor, id: string) {
  assertCan(actor, "customers.archive");
  return db.transaction(async (tx) => {
    const c = await getCustomerForActor(tx, actor, id);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.ledgerTransactions).where(and(eq(s.ledgerTransactions.partyType, "CUSTOMER"), eq(s.ledgerTransactions.partyId, id)));
    const [{ m }] = await tx.select({ m: sql<number>`count(*)::int` }).from(s.sales).where(eq(s.sales.customerId, id));
    if (n > 0 || m > 0) throw new AppError("This customer has transaction history and cannot be deleted. Archive them instead.", undefined, "CONFLICT");
    await tx.delete(s.customers).where(eq(s.customers.id, id));
    await audit(tx, actor, "DELETE", "customer", id, `Customer ${c.name} (${c.code}) deleted (no history)`, { before: c });
  });
}

// ---------------------------------------------------------------- suppliers CRUD
export async function createSupplier(db: DB, actor: Actor, raw: SupplierInput) {
  assertCan(actor, "suppliers.manage");
  const input = supplierSchema.parse(raw);
  return db.transaction(async (tx) => {
    const code = await nextCode(tx, "supplier");
    const opening = toPaise(input.openingBalance);
    const [sup] = await tx
      .insert(s.suppliers)
      .values({
        code,
        name: input.name,
        contactPerson: input.contactPerson,
        mobile: input.mobile,
        whatsapp: input.whatsapp ?? input.mobile,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        stateCode: input.stateCode ?? (input.gstin ? input.gstin.slice(0, 2) : null),
        notes: input.notes,
        openingBalance: fromPaise(opening),
        createdBy: actor.id,
      })
      .returning();
    await postOpeningBalance(tx, actor, { type: "SUPPLIER", id: sup.id }, opening, todayIST());
    await audit(tx, actor, "CREATE", "supplier", sup.id, `Supplier ${sup.name} (${sup.code}) created`, { after: sup });
    return sup;
  });
}

export async function updateSupplier(db: DB, actor: Actor, id: string, raw: SupplierInput) {
  assertCan(actor, "suppliers.manage");
  const input = supplierSchema.parse(raw);
  return db.transaction(async (tx) => {
    const before = await getSupplier(tx, actor, id);
    const opening = toPaise(input.openingBalance);
    const [after] = await tx
      .update(s.suppliers)
      .set({
        name: input.name,
        contactPerson: input.contactPerson,
        mobile: input.mobile,
        whatsapp: input.whatsapp ?? input.mobile,
        email: input.email,
        address: input.address,
        gstin: input.gstin,
        stateCode: input.stateCode ?? (input.gstin ? input.gstin.slice(0, 2) : null),
        notes: input.notes,
        openingBalance: fromPaise(opening),
        updatedAt: new Date(),
      })
      .where(eq(s.suppliers.id, id))
      .returning();
    if (toPaise(before.openingBalance) !== opening) await changeOpeningBalance(tx, actor, { type: "SUPPLIER", id }, opening);
    await audit(tx, actor, "UPDATE", "supplier", id, `Supplier ${after.name} updated`, { before, after });
    return after;
  });
}

export async function archiveSupplier(db: DB, actor: Actor, id: string, archive: boolean) {
  assertCan(actor, "suppliers.manage");
  return db.transaction(async (tx) => {
    const sup = await getSupplier(tx, actor, id);
    await tx.update(s.suppliers).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(eq(s.suppliers.id, id));
    await audit(tx, actor, archive ? "ARCHIVE" : "RESTORE", "supplier", id, `Supplier ${sup.name} ${archive ? "archived" : "restored"}`);
  });
}
