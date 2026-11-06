/**
 * Core server primitives shared by every service: actor/permissions, typed
 * errors, gap-free numbering, audit logging and the double-entry posting engine.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Executor, Tx } from "./db/client";
import * as s from "./db/schema";
import type { Permission, RoleKey } from "@/lib/permissions";
import { fromPaise, toPaise, type Paise } from "@/lib/money";
import { financialYear } from "@/lib/dates";

// ---------------------------------------------------------------- actor & errors
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  permissions: Set<Permission>;
  ip?: string | null;
};

export class AppError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
    public code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" = "VALIDATION",
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(`${what} not found`, undefined, "NOT_FOUND");

export function can(actor: Actor, p: Permission): boolean {
  return actor.role === "OWNER" || actor.permissions.has(p);
}
export function assertCan(actor: Actor, ...ps: Permission[]) {
  for (const p of ps) if (!can(actor, p)) throw new AppError("You do not have permission to do this.", undefined, "FORBIDDEN");
}

// ---------------------------------------------------------------- numbering
/** Atomically increments and returns the next value of a counter (row lock until commit). */
export async function nextCounter(tx: Executor, key: string): Promise<number> {
  const rows = await tx
    .insert(s.counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: s.counters.key, set: { value: sql`${s.counters.value} + 1` } })
    .returning({ value: s.counters.value });
  return rows[0].value;
}

export async function getSettingsRow(tx: Executor) {
  const [row] = await tx.select().from(s.businessSettings).where(eq(s.businessSettings.id, 1));
  if (!row) throw new Error("Business settings missing — run migrations");
  return row;
}

export type DocKind = "invoice" | "receipt" | "voucher" | "purchase" | "creditnote" | "expense";
const DOC_DEFAULT_PREFIX: Record<DocKind, string> = {
  invoice: "MT",
  receipt: "RC",
  voucher: "PV",
  purchase: "PU",
  creditnote: "CN",
  expense: "EX",
};

/** Financial-year scoped document number, e.g. MT/2026-27/0001 (≤16 chars for GST invoices). */
export async function nextDocNumber(tx: Executor, kind: DocKind, date: string): Promise<string> {
  const settings = await getSettingsRow(tx);
  const fy = financialYear(date, settings.fyStartMonth);
  const prefix =
    kind === "invoice" ? settings.invoicePrefix : kind === "receipt" ? settings.receiptPrefix : kind === "purchase" ? settings.purchasePrefix : DOC_DEFAULT_PREFIX[kind];
  const n = await nextCounter(tx, `${kind}:${fy}`);
  const shortFy = `${fy.slice(2, 4)}-${fy.slice(5)}`; // 26-27
  return `${prefix}/${shortFy}/${String(n).padStart(4, "0")}`;
}

export async function nextCode(tx: Executor, key: "customer" | "supplier" | "product" | "txn" | "journal"): Promise<string> {
  const n = await nextCounter(tx, key);
  switch (key) {
    case "customer":
      return `C-${String(n).padStart(4, "0")}`;
    case "supplier":
      return `S-${String(n).padStart(4, "0")}`;
    case "product":
      return `P-${String(n).padStart(4, "0")}`;
    case "txn":
      return `T-${String(n).padStart(6, "0")}`;
    case "journal":
      return `JE-${String(n).padStart(6, "0")}`;
  }
}

// ---------------------------------------------------------------- audit
export async function audit(
  tx: Executor,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  data: { before?: unknown; after?: unknown } = {},
) {
  await tx.insert(s.auditLogs).values({
    userId: actor?.id ?? null,
    action,
    entityType,
    entityId,
    summary,
    before: (data.before ?? null) as never,
    after: (data.after ?? null) as never,
    ip: actor?.ip ?? null,
  });
}

// ---------------------------------------------------------------- posting engine
export type Party = { type: "CUSTOMER" | "SUPPLIER"; id: string };
export type PostingLine = { account: string; debit?: Paise; credit?: Paise; party?: Party | null; description?: string };

export type JournalInput = {
  date: string;
  memo: string;
  sourceType: string;
  sourceId?: string | null;
  lines: PostingLine[];
  reversalOfId?: string | null;
};

async function accountIds(tx: Executor, codes: string[]): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: s.ledgerAccounts.id, code: s.ledgerAccounts.code })
    .from(s.ledgerAccounts)
    .where(inArray(s.ledgerAccounts.code, [...new Set(codes)]));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Posts a balanced journal entry. Zero lines are dropped; same account/party/side
 * lines are merged. Throws if unbalanced. The DB re-checks balance at commit.
 */
export async function postJournal(tx: Tx, actor: Actor, input: JournalInput): Promise<{ id: string; entryNo: string }> {
  const merged = new Map<string, { account: string; party?: Party | null; debit: Paise; credit: Paise; description?: string }>();
  for (const l of input.lines) {
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new Error("Posting amounts must be integer paise");
    if (debit < 0 || credit < 0) {
      // A negative amount on one side is the same as a positive amount on the other.
      const d = (debit < 0 ? 0 : debit) + (credit < 0 ? -credit : 0);
      const c = (credit < 0 ? 0 : credit) + (debit < 0 ? -debit : 0);
      input.lines.push({ ...l, debit: d, credit: c });
      continue;
    }
    if (debit === 0 && credit === 0) continue;
    const net = debit - credit;
    const key = `${l.account}|${l.party?.type ?? ""}|${l.party?.id ?? ""}`;
    const cur = merged.get(key) ?? { account: l.account, party: l.party, debit: 0, credit: 0, description: l.description };
    const curNet = cur.debit - cur.credit + net;
    cur.debit = curNet > 0 ? curNet : 0;
    cur.credit = curNet < 0 ? -curNet : 0;
    merged.set(key, cur);
  }
  const lines = [...merged.values()].filter((l) => l.debit !== 0 || l.credit !== 0);
  const totalDr = lines.reduce((a, l) => a + l.debit, 0);
  const totalCr = lines.reduce((a, l) => a + l.credit, 0);
  if (totalDr !== totalCr) throw new Error(`Unbalanced journal: debit ${totalDr} ≠ credit ${totalCr}`);
  if (totalDr === 0 || lines.length < 2) throw new Error("Journal entry has no value");

  const ids = await accountIds(tx, lines.map((l) => l.account));
  const entryNo = await nextCode(tx, "journal");
  const [entry] = await tx
    .insert(s.journalEntries)
    .values({
      entryNo,
      entryDate: input.date,
      memo: input.memo,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdBy: actor.id,
    })
    .returning({ id: s.journalEntries.id });
  await tx.insert(s.journalEntryLines).values(
    lines.map((l) => {
      const accountId = ids.get(l.account);
      if (!accountId) throw new Error(`Unknown ledger account ${l.account}`);
      return {
        journalEntryId: entry.id,
        accountId,
        partyType: l.party?.type ?? null,
        partyId: l.party?.id ?? null,
        debit: fromPaise(l.debit),
        credit: fromPaise(l.credit),
        description: l.description ?? null,
      };
    }),
  );
  return { id: entry.id, entryNo };
}

/** Posts the mirror image of an entry and flags the original as reversed. */
export async function reverseJournal(tx: Tx, actor: Actor, journalEntryId: string, memo: string, date: string) {
  const [orig] = await tx.select().from(s.journalEntries).where(eq(s.journalEntries.id, journalEntryId)).for("update");
  if (!orig) throw notFound("Journal entry");
  if (orig.isReversed) throw new AppError("This entry has already been reversed.", undefined, "CONFLICT");
  const lines = await tx
    .select({
      code: s.ledgerAccounts.code,
      debit: s.journalEntryLines.debit,
      credit: s.journalEntryLines.credit,
      partyType: s.journalEntryLines.partyType,
      partyId: s.journalEntryLines.partyId,
    })
    .from(s.journalEntryLines)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.journalEntryLines.accountId))
    .where(eq(s.journalEntryLines.journalEntryId, journalEntryId));
  const rev = await postJournal(tx, actor, {
    date,
    memo,
    sourceType: orig.sourceType,
    sourceId: orig.sourceId,
    reversalOfId: orig.id,
    lines: lines.map((l) => ({
      account: l.code,
      debit: toPaise(l.credit),
      credit: toPaise(l.debit),
      party: l.partyType && l.partyId ? { type: l.partyType, id: l.partyId } : null,
    })),
  });
  await tx.update(s.journalEntries).set({ isReversed: true }).where(eq(s.journalEntries.id, journalEntryId));
  return rev;
}

// ---------------------------------------------------------------- party balances (authoritative: journal lines)
/** Customer: + = customer owes us. Supplier: + = we owe supplier. */
export async function partyBalance(tx: Executor, party: Party): Promise<Paise> {
  const control = party.type === "CUSTOMER" ? "1100" : "2000";
  const [row] = await tx
    .select({
      bal:
        party.type === "CUSTOMER"
          ? sql<string>`coalesce(sum(${s.journalEntryLines.debit} - ${s.journalEntryLines.credit}), 0)`
          : sql<string>`coalesce(sum(${s.journalEntryLines.credit} - ${s.journalEntryLines.debit}), 0)`,
    })
    .from(s.journalEntryLines)
    .innerJoin(s.ledgerAccounts, eq(s.ledgerAccounts.id, s.journalEntryLines.accountId))
    .where(
      and(
        eq(s.ledgerAccounts.code, control),
        eq(s.journalEntryLines.partyType, party.type),
        eq(s.journalEntryLines.partyId, party.id),
      ),
    );
  return toPaise(row?.bal ?? "0");
}

/** Creates the khata row that mirrors a journal entry's effect on a party. */
export async function insertLedgerTxn(
  tx: Tx,
  actor: Actor,
  v: {
    party: Party;
    date: string;
    type: (typeof s.ledgerTxnTypeEnum.enumValues)[number];
    description: string;
    amount: Paise;
    balanceEffect: Paise;
    journalEntryId: string;
    paymentMethod?: (typeof s.paymentMethodEnum.enumValues)[number] | null;
    referenceNo?: string | null;
    notes?: string | null;
    attachmentKey?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    status?: "ACTIVE" | "REVERSAL";
    reversalOfId?: string | null;
    idempotencyKey?: string | null;
  },
) {
  if (v.amount <= 0) throw new AppError("Amount must be greater than zero");
  const txnNo = await nextCode(tx, "txn");
  const [row] = await tx
    .insert(s.ledgerTransactions)
    .values({
      txnNo,
      partyType: v.party.type,
      partyId: v.party.id,
      txnDate: v.date,
      type: v.type,
      description: v.description,
      amount: fromPaise(v.amount),
      balanceEffect: fromPaise(v.balanceEffect),
      paymentMethod: v.paymentMethod ?? null,
      referenceNo: v.referenceNo ?? null,
      notes: v.notes ?? null,
      attachmentKey: v.attachmentKey ?? null,
      sourceType: v.sourceType ?? null,
      sourceId: v.sourceId ?? null,
      journalEntryId: v.journalEntryId,
      status: v.status ?? "ACTIVE",
      reversalOfId: v.reversalOfId ?? null,
      idempotencyKey: v.idempotencyKey ?? null,
      createdBy: actor.id,
    })
    .returning();
  return row;
}

/** Reverses a khata row together with its journal entry. */
export async function reverseLedgerTxnRow(tx: Tx, actor: Actor, ltId: string, reason: string, date: string) {
  const [lt] = await tx.select().from(s.ledgerTransactions).where(eq(s.ledgerTransactions.id, ltId)).for("update");
  if (!lt) throw notFound("Transaction");
  if (lt.status !== "ACTIVE") throw new AppError("Only active entries can be reversed.", undefined, "CONFLICT");
  const rev = await reverseJournal(tx, actor, lt.journalEntryId, `Reversal of ${lt.txnNo}: ${reason}`, date);
  const revRow = await insertLedgerTxn(tx, actor, {
    party: { type: lt.partyType, id: lt.partyId },
    date,
    type: "REVERSAL",
    description: `Reversal of ${lt.txnNo} — ${lt.description}`,
    amount: toPaise(lt.amount),
    balanceEffect: -toPaise(lt.balanceEffect),
    journalEntryId: rev.id,
    paymentMethod: lt.paymentMethod,
    notes: reason,
    sourceType: lt.sourceType,
    sourceId: lt.sourceId,
    status: "REVERSAL",
    reversalOfId: lt.id,
  });
  await tx
    .update(s.ledgerTransactions)
    .set({ status: "REVERSED", reversedAt: new Date(), reversedBy: actor.id, reversalReason: reason })
    .where(eq(s.ledgerTransactions.id, lt.id));
  return { original: lt, reversal: revRow };
}
