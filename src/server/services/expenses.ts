/**
 * Business expenses: Dr <category expense> / Cr <money account>.
 * Editing reverses the old journal entry and posts a new one (full audit trail).
 * Expenses never touch customer receivables.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { DB, Executor, Tx } from "../db/client";
import * as s from "../db/schema";
import { AppError, assertCan, audit, nextDocNumber, notFound, postJournal, reverseJournal, type Actor } from "../core";
import { EXPENSE_CATEGORIES, moneyAccountFor, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { expenseSchema, type ExpenseInput } from "@/lib/validators";
import { formatINR, toPaise } from "@/lib/money";
import { todayIST } from "@/lib/dates";

const codeFor = (cat: string) => EXPENSE_CATEGORIES.find((c) => c.key === cat)?.code ?? "6007";

async function postExpense(tx: Tx, actor: Actor, e: { id: string; expenseNo: string; date: string; category: string; amount: number; method: PaymentMethod; payee: string | null }) {
  return postJournal(tx, actor, {
    date: e.date,
    memo: `Expense ${e.expenseNo} — ${e.category}${e.payee ? ` (${e.payee})` : ""} via ${PAYMENT_METHOD_LABEL[e.method]}`,
    sourceType: "EXPENSE",
    sourceId: e.id,
    lines: [
      { account: codeFor(e.category), debit: e.amount },
      { account: moneyAccountFor(e.method), credit: e.amount },
    ],
  });
}

export async function createExpense(db: DB, actor: Actor, raw: ExpenseInput) {
  assertCan(actor, "expenses.manage");
  const input = expenseSchema.parse(raw);
  const [dup] = await db.select().from(s.expenses).where(eq(s.expenses.idempotencyKey, input.idempotencyKey));
  if (dup) return { expense: dup, duplicate: true };
  const expense = await db.transaction(async (tx) => {
    const id = crypto.randomUUID();
    const expenseNo = await nextDocNumber(tx, "expense", input.date);
    const amount = toPaise(input.amount);
    const je = await postExpense(tx, actor, { id, expenseNo, date: input.date, category: input.category, amount, method: input.paymentMethod, payee: input.payee });
    const [row] = await tx
      .insert(s.expenses)
      .values({
        id,
        expenseNo,
        expenseDate: input.date,
        category: input.category,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        referenceNo: input.referenceNo,
        payee: input.payee,
        description: input.description,
        receiptKey: input.receiptKey,
        journalEntryId: je.id,
        idempotencyKey: input.idempotencyKey,
        createdBy: actor.id,
      })
      .returning();
    await audit(tx, actor, "CREATE", "expense", id, `Expense ${expenseNo}: ${formatINR(amount)} (${input.category})`, { after: row });
    return row;
  });
  return { expense, duplicate: false };
}

export async function updateExpense(db: DB, actor: Actor, id: string, raw: ExpenseInput) {
  assertCan(actor, "expenses.manage");
  const input = expenseSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(s.expenses).where(eq(s.expenses.id, id)).for("update");
    if (!before) throw notFound("Expense");
    if (before.status !== "ACTIVE") throw new AppError("A voided expense cannot be edited.");
    const amount = toPaise(input.amount);
    let journalEntryId = before.journalEntryId;
    const financialChange =
      toPaise(before.amount) !== amount || before.category !== input.category || before.paymentMethod !== input.paymentMethod || before.expenseDate !== input.date;
    if (financialChange) {
      await reverseJournal(tx, actor, before.journalEntryId!, `Expense ${before.expenseNo} edited (reversal of original)`, todayIST());
      const je = await postExpense(tx, actor, { id, expenseNo: before.expenseNo, date: input.date, category: input.category, amount, method: input.paymentMethod, payee: input.payee });
      journalEntryId = je.id;
    }
    const [after] = await tx
      .update(s.expenses)
      .set({
        expenseDate: input.date,
        category: input.category,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        referenceNo: input.referenceNo,
        payee: input.payee,
        description: input.description,
        receiptKey: input.receiptKey ?? before.receiptKey,
        journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(s.expenses.id, id))
      .returning();
    await audit(tx, actor, "UPDATE", "expense", id, `Expense ${before.expenseNo} edited${financialChange ? " (ledger re-posted)" : ""}`, { before, after });
    return after;
  });
}

export async function voidExpense(db: DB, actor: Actor, id: string, reason: string) {
  assertCan(actor, "expenses.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Please give a reason");
  await db.transaction(async (tx) => {
    const [e] = await tx.select().from(s.expenses).where(eq(s.expenses.id, id)).for("update");
    if (!e) throw notFound("Expense");
    if (e.status !== "ACTIVE") throw new AppError("Already voided.");
    await reverseJournal(tx, actor, e.journalEntryId!, `Expense ${e.expenseNo} voided: ${reason}`, todayIST());
    await tx.update(s.expenses).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(s.expenses.id, id));
    await audit(tx, actor, "VOID", "expense", id, `Expense ${e.expenseNo} voided: ${reason}`, { before: e });
  });
}

export async function listExpenses(db: Executor, actor: Actor, f: { q?: string; from?: string; to?: string; category?: string; method?: string; includeVoid?: boolean; limit?: number; offset?: number } = {}) {
  assertCan(actor, "expenses.view");
  const where = and(
    f.from ? sql`${s.expenses.expenseDate} >= ${f.from}` : undefined,
    f.to ? sql`${s.expenses.expenseDate} <= ${f.to}` : undefined,
    f.category ? eq(s.expenses.category, f.category) : undefined,
    f.method ? eq(s.expenses.paymentMethod, f.method as PaymentMethod) : undefined,
    f.includeVoid ? undefined : eq(s.expenses.status, "ACTIVE"),
    f.q ? or(ilike(s.expenses.expenseNo, `%${f.q}%`), ilike(s.expenses.payee, `%${f.q}%`), ilike(s.expenses.description, `%${f.q}%`)) : undefined,
  );
  const rows = await db
    .select({ e: s.expenses, by: s.users.name })
    .from(s.expenses)
    .leftJoin(s.users, eq(s.users.id, s.expenses.createdBy))
    .where(where)
    .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.createdAt))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);
  const [agg] = await db
    .select({ total: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(case when ${s.expenses.status} = 'ACTIVE' then ${s.expenses.amount} end), 0)` })
    .from(s.expenses)
    .where(where);
  const byCat = await db
    .select({ category: s.expenses.category, amount: sql<string>`sum(${s.expenses.amount})` })
    .from(s.expenses)
    .where(and(where, eq(s.expenses.status, "ACTIVE")))
    .groupBy(s.expenses.category);
  return {
    total: agg.total,
    amount: toPaise(agg.amount),
    byCategory: byCat.map((c) => ({ category: c.category, amount: toPaise(c.amount) })).sort((a, b) => b.amount - a.amount),
    rows: rows.map((r) => ({ ...r.e, amountP: toPaise(r.e.amount), by: r.by })),
  };
}
