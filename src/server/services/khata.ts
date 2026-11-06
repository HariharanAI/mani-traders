/**
 * Digital khata: manual ledger entries for customers & suppliers, reversals
 * and statements with running balance.
 *
 * Plain-language entry kinds → accounting:
 *  CUSTOMER  GAVE_GOODS  credit sale, no itemised bill   Dr Receivable / Cr Sales          (+ owes us more)
 *            GAVE_MONEY  cash given / refund             Dr Receivable / Cr Cash|Bank      (+)
 *            GOT_MONEY   payment received                Dr Cash|Bank / Cr Receivable      (−)
 *            GOT_GOODS   goods returned by customer      Dr Sales Returns / Cr Receivable  (−)
 *            ADJUST_UP   balance correction upward       Dr Receivable / Cr Other Income   (+)
 *            ADJUST_DOWN discount / write-off            Dr Discounts / Cr Receivable      (−)
 *  SUPPLIER  GOT_GOODS   bill without items              Dr Purchases / Cr Payable         (+ we owe more)
 *            GAVE_MONEY  payment made                    Dr Payable / Cr Cash|Bank         (−)
 *            GOT_MONEY   refund from supplier            Dr Cash|Bank / Cr Payable         (+)
 *            GAVE_GOODS  goods returned to supplier      Dr Payable / Cr Purchases         (−)
 *            ADJUST_UP   correction upward               Dr Discounts / Cr Payable         (+)
 *            ADJUST_DOWN discount received               Dr Payable / Cr Other Income      (−)
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import {
  AppError,
  assertCan,
  audit,
  getSettingsRow,
  insertLedgerTxn,
  notFound,
  postJournal,
  reverseLedgerTxnRow,
  type Actor,
  type Party,
  type PostingLine,
} from "../core";
import { ACC } from "@/lib/accounts";
import { khataEntrySchema, type KhataEntryInput } from "@/lib/validators";
import { formatINR, toPaise, type Paise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { assertPartyAccess, customerScope } from "./parties";
import { recordPaymentTx, reversePaymentTx } from "./payments";
import { notify } from "./notifications";

type Kind = KhataEntryInput["kind"];

function plan(partyType: Party["type"], kind: Kind, party: Party, amount: Paise) {
  const AR = ACC.RECEIVABLE;
  const AP = ACC.PAYABLE;
  const P = (account: string, debit: number, credit: number, withParty = false): PostingLine => ({ account, debit, credit, party: withParty ? party : null });
  if (partyType === "CUSTOMER") {
    switch (kind) {
      case "GAVE_GOODS":
        return { type: "CREDIT_GIVEN" as const, effect: amount, label: "Goods given on credit", lines: [P(AR, amount, 0, true), P(ACC.SALES, 0, amount)] };
      case "GOT_GOODS":
        return { type: "SALES_RETURN" as const, effect: -amount, label: "Goods returned by customer", lines: [P(ACC.SALES_RETURNS, amount, 0), P(AR, 0, amount, true)] };
      case "ADJUST_UP":
        return { type: "ADJUSTMENT" as const, effect: amount, label: "Balance adjustment (increase)", lines: [P(AR, amount, 0, true), P(ACC.OTHER_INCOME, 0, amount)] };
      case "ADJUST_DOWN":
        return { type: "ADJUSTMENT" as const, effect: -amount, label: "Discount / write-off", lines: [P(ACC.DISCOUNTS_WRITEOFF, amount, 0), P(AR, 0, amount, true)] };
    }
  } else {
    switch (kind) {
      case "GOT_GOODS":
        return { type: "PURCHASE" as const, effect: amount, label: "Goods purchased on credit", lines: [P("6006", amount, 0), P(AP, 0, amount, true)] };
      case "GAVE_GOODS":
        return { type: "PURCHASE_RETURN" as const, effect: -amount, label: "Goods returned to supplier", lines: [P(AP, amount, 0, true), P("6006", 0, amount)] };
      case "ADJUST_UP":
        return { type: "ADJUSTMENT" as const, effect: amount, label: "Balance adjustment (increase)", lines: [P(ACC.DISCOUNTS_WRITEOFF, amount, 0), P(AP, 0, amount, true)] };
      case "ADJUST_DOWN":
        return { type: "ADJUSTMENT" as const, effect: -amount, label: "Discount received", lines: [P(AP, amount, 0, true), P(ACC.OTHER_INCOME, 0, amount)] };
    }
  }
  return null;
}

/** Adds a khata entry. Money entries are routed through the payments service (receipt / voucher). */
export async function addKhataEntry(db: DB, actor: Actor, raw: KhataEntryInput) {
  const input = khataEntrySchema.parse(raw);
  const party: Party = { type: input.partyType, id: input.partyId };
  const amount = toPaise(input.amount);

  const [dup] = await db.select().from(s.ledgerTransactions).where(eq(s.ledgerTransactions.idempotencyKey, `lt:${input.idempotencyKey}`));
  if (dup) return { entry: dup, duplicate: true };

  if (input.kind === "GOT_MONEY" || input.kind === "GAVE_MONEY") {
    if (!input.paymentMethod) throw new AppError("Select a payment method", { paymentMethod: "Required" });
    const direction = input.kind === "GOT_MONEY" ? "IN" : "OUT";
    const payment = await db.transaction((tx) =>
      recordPaymentTx(tx, actor, {
        direction,
        party,
        amount,
        method: input.paymentMethod!,
        date: input.date,
        referenceNo: input.referenceNo,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        description: input.description ?? undefined,
      }),
    );
    const [entry] = await db.select().from(s.ledgerTransactions).where(eq(s.ledgerTransactions.id, payment.ledgerTransactionId!));
    return { entry, payment, duplicate: false };
  }

  assertCan(actor, "ledger.create");
  const p = plan(party.type, input.kind, party, amount);
  if (!p) throw new AppError("This entry type is not available for this party.");
  const entry = await db.transaction(async (tx) => {
    const partyRow = await assertPartyAccess(tx, actor, party);
    const ltId = crypto.randomUUID();
    const je = await postJournal(tx, actor, {
      date: input.date,
      memo: `${p.label} — ${partyRow.name}`,
      sourceType: "LEDGER",
      sourceId: ltId,
      lines: p.lines,
    });
    const row = await insertLedgerTxn(tx, actor, {
      party,
      date: input.date,
      type: p.type,
      description: input.description || p.label,
      amount,
      balanceEffect: p.effect,
      journalEntryId: je.id,
      referenceNo: input.referenceNo,
      notes: input.notes,
      attachmentKey: input.attachmentKey,
      sourceType: "LEDGER",
      sourceId: ltId,
      idempotencyKey: `lt:${input.idempotencyKey}`,
    });
    await audit(tx, actor, "CREATE", "ledger_transaction", row.id, `${row.txnNo} ${p.label}: ${formatINR(amount)} — ${partyRow.name}`, { after: row });
    if (party.type === "CUSTOMER" && p.effect > 0) {
      await notify(tx, {
        type: "CREDIT_GIVEN",
        title: `${formatINR(amount)} credit given to ${partyRow.name}`,
        body: `${p.label} · by ${actor.name}`,
        link: `/customers/${party.id}`,
        audience: "MANAGERS",
      });
    }
    const settings = await getSettingsRow(tx);
    if (amount >= toPaise(settings.unusualTxnThreshold)) {
      await notify(tx, { type: "UNUSUAL", title: `Large khata entry: ${formatINR(amount)} — ${partyRow.name}`, body: `${p.label} · ${row.txnNo} · by ${actor.name}`, link: `/${party.type === "CUSTOMER" ? "customers" : "suppliers"}/${party.id}`, severity: "warning" });
    }
    return row;
  });
  return { entry, duplicate: false };
}

/** Reverses a khata entry. Sales/purchases must be cancelled from their own screen. */
export async function reverseKhataEntry(db: DB, actor: Actor, ltId: string, reason: string) {
  return db.transaction(async (tx) => {
    const [lt] = await tx.select().from(s.ledgerTransactions).where(eq(s.ledgerTransactions.id, ltId));
    if (!lt) throw notFound("Entry");
    await assertPartyAccess(tx, actor, { type: lt.partyType, id: lt.partyId });
    if (lt.sourceType === "SALE" || lt.sourceType === "SALE_RETURN") throw new AppError("This entry belongs to an invoice. Cancel the invoice instead.");
    if (lt.sourceType === "PURCHASE") throw new AppError("This entry belongs to a purchase. Cancel the purchase instead.");
    if (lt.sourceType === "PAYMENT" && lt.sourceId) {
      await reversePaymentTx(tx, actor, lt.sourceId, reason);
      return;
    }
    assertCan(actor, "ledger.reverse");
    const { reversal } = await reverseLedgerTxnRow(tx, actor, ltId, reason, todayIST());
    await audit(tx, actor, "REVERSE", "ledger_transaction", ltId, `${lt.txnNo} reversed by ${reversal.txnNo}: ${reason}`, { before: lt, after: reversal });
    await notify(tx, { type: "REVERSAL", title: `Khata entry ${lt.txnNo} reversed`, body: `${formatINR(toPaise(lt.amount))} · ${reason} · by ${actor.name}`, severity: "warning" });
  });
}

export type StatementRow = typeof s.ledgerTransactions.$inferSelect & {
  amountP: Paise;
  effectP: Paise;
  running: Paise;
  createdByName: string | null;
};

/** Full statement with running balance. Opening = balance before `from`. */
export async function partyStatement(db: Executor, actor: Actor, party: Party, range: { from?: string; to?: string } = {}) {
  assertCan(actor, "ledger.view");
  const partyRow = await assertPartyAccess(db, actor, party);
  const base = and(eq(s.ledgerTransactions.partyType, party.type), eq(s.ledgerTransactions.partyId, party.id));
  let opening = 0;
  if (range.from) {
    const [r] = await db
      .select({ v: sql<string>`coalesce(sum(${s.ledgerTransactions.balanceEffect}), 0)` })
      .from(s.ledgerTransactions)
      .where(and(base, sql`${s.ledgerTransactions.txnDate} < ${range.from}`));
    opening = toPaise(r.v);
  }
  const rows = await db
    .select({ lt: s.ledgerTransactions, createdByName: s.users.name })
    .from(s.ledgerTransactions)
    .leftJoin(s.users, eq(s.users.id, s.ledgerTransactions.createdBy))
    .where(
      and(
        base,
        range.from ? sql`${s.ledgerTransactions.txnDate} >= ${range.from}` : undefined,
        range.to ? sql`${s.ledgerTransactions.txnDate} <= ${range.to}` : undefined,
      ),
    )
    .orderBy(asc(s.ledgerTransactions.txnDate), asc(s.ledgerTransactions.createdAt));
  let running = opening;
  let increases = 0;
  let decreases = 0;
  const out: StatementRow[] = rows.map((r) => {
    const effectP = toPaise(r.lt.balanceEffect);
    running += effectP;
    if (effectP > 0) increases += effectP;
    else decreases += -effectP;
    return { ...r.lt, amountP: toPaise(r.lt.amount), effectP, running, createdByName: r.createdByName };
  });
  return { party: partyRow, opening, closing: running, increases, decreases, rows: out };
}

/** Recent khata activity across all permitted parties (for the Khata page feed). */
export async function recentLedger(db: Executor, actor: Actor, opts: { limit?: number; partyType?: Party["type"]; from?: string; to?: string; q?: string } = {}) {
  assertCan(actor, "ledger.view");
  const scope = customerScope(actor);
  const partyName = sql<string>`coalesce(${s.customers.name}, ${s.suppliers.name})`;
  const rows = await db
    .select({ lt: s.ledgerTransactions, partyName, createdByName: s.users.name })
    .from(s.ledgerTransactions)
    .leftJoin(s.customers, and(eq(s.ledgerTransactions.partyType, "CUSTOMER"), eq(s.customers.id, s.ledgerTransactions.partyId)))
    .leftJoin(s.suppliers, and(eq(s.ledgerTransactions.partyType, "SUPPLIER"), eq(s.suppliers.id, s.ledgerTransactions.partyId)))
    .leftJoin(s.users, eq(s.users.id, s.ledgerTransactions.createdBy))
    .where(
      and(
        opts.partyType ? eq(s.ledgerTransactions.partyType, opts.partyType) : undefined,
        opts.from ? sql`${s.ledgerTransactions.txnDate} >= ${opts.from}` : undefined,
        opts.to ? sql`${s.ledgerTransactions.txnDate} <= ${opts.to}` : undefined,
        opts.q ? sql`(${s.ledgerTransactions.txnNo} ilike ${"%" + opts.q + "%"} or ${partyName} ilike ${"%" + opts.q + "%"} or ${s.ledgerTransactions.description} ilike ${"%" + opts.q + "%"})` : undefined,
        scope ? sql`(${s.ledgerTransactions.partyType} = 'CUSTOMER' and ${s.customers.assignedTo} = ${actor.id})` : undefined,
        !scope && !(actor.role === "OWNER" || actor.permissions.has("suppliers.view")) ? eq(s.ledgerTransactions.partyType, "CUSTOMER") : undefined,
      ),
    )
    .orderBy(desc(s.ledgerTransactions.createdAt))
    .limit(opts.limit ?? 50);
  return rows.map((r) => ({ ...r.lt, amountP: toPaise(r.lt.amount), effectP: toPaise(r.lt.balanceEffect), partyName: r.partyName, createdByName: r.createdByName }));
}
