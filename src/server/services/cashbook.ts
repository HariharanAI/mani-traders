/**
 * Cash & bank: balances of each money account, plus owner-level entries that
 * do not involve a customer or supplier:
 *   OPENING   opening balance when starting to use the app   Dr money / Cr Opening Balance Equity
 *   CAPITAL   owner puts money into the business             Dr money / Cr Owner's Capital
 *   DRAWINGS  owner takes money out                          Dr Owner's Capital / Cr money
 *   TRANSFER  e.g. cash deposited in bank                    Dr to-account / Cr from-account
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import { AppError, assertCan, audit, postJournal, type Actor } from "../core";
import { ACC, MONEY_ACCOUNT_CODES, moneyAccountFor, PAYMENT_METHOD_LABEL } from "@/lib/accounts";
import { amountStr, dateStr, paymentMethod } from "@/lib/validators";
import { formatINR, toPaise } from "@/lib/money";

export const cashEntrySchema = z.object({
  kind: z.enum(["OPENING", "CAPITAL", "DRAWINGS", "TRANSFER"]),
  account: paymentMethod,
  toAccount: paymentMethod.optional(),
  amount: amountStr(),
  date: dateStr,
  note: z.string().trim().max(200).optional().nullable(),
});

const NAMES: Record<string, string> = { [ACC.CASH]: "Cash in hand", [ACC.BANK]: "Bank", [ACC.UPI]: "UPI collections", [ACC.OTHER_MONEY]: "Other" };

export async function moneyBalances(db: Executor) {
  const rows = await db
    .select({ code: s.ledgerAccounts.code, bal: sql<string>`coalesce(sum(${s.journalEntryLines.debit} - ${s.journalEntryLines.credit}), 0)` })
    .from(s.ledgerAccounts)
    .leftJoin(s.journalEntryLines, eq(s.journalEntryLines.accountId, s.ledgerAccounts.id))
    .where(inArray(s.ledgerAccounts.code, MONEY_ACCOUNT_CODES))
    .groupBy(s.ledgerAccounts.code)
    .orderBy(s.ledgerAccounts.code);
  return rows.map((r) => ({ code: r.code, name: NAMES[r.code], balance: toPaise(r.bal) }));
}

export async function addCashEntry(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "settings.manage");
  const input = cashEntrySchema.parse(raw);
  const amount = toPaise(input.amount);
  const money = moneyAccountFor(input.account);
  let lines;
  let memo: string;
  switch (input.kind) {
    case "OPENING":
      lines = [{ account: money, debit: amount }, { account: ACC.OPENING_EQUITY, credit: amount }];
      memo = `Opening balance — ${NAMES[money]}`;
      break;
    case "CAPITAL":
      lines = [{ account: money, debit: amount }, { account: ACC.CAPITAL, credit: amount }];
      memo = `Owner's capital introduced — ${NAMES[money]}`;
      break;
    case "DRAWINGS":
      lines = [{ account: ACC.CAPITAL, debit: amount }, { account: money, credit: amount }];
      memo = `Owner's drawings — ${NAMES[money]}`;
      break;
    case "TRANSFER": {
      if (!input.toAccount) throw new AppError("Choose where the money went", { toAccount: "Required" });
      const to = moneyAccountFor(input.toAccount);
      if (to === money) throw new AppError("From and to accounts are the same.");
      lines = [{ account: to, debit: amount }, { account: money, credit: amount }];
      memo = `Transfer ${NAMES[money]} → ${NAMES[to]}`;
      break;
    }
  }
  if (input.note) memo += ` · ${input.note}`;
  return db.transaction(async (tx) => {
    const je = await postJournal(tx, actor, { date: input.date, memo, sourceType: "MONEY", lines });
    await audit(tx, actor, "CREATE", "cashbook", je.id, `${memo}: ${formatINR(amount)} (${PAYMENT_METHOD_LABEL[input.account]})`);
    return je;
  });
}

export async function listCashEntries(db: Executor, limit = 20) {
  const rows = await db
    .select({ id: s.journalEntries.id, no: s.journalEntries.entryNo, date: s.journalEntries.entryDate, memo: s.journalEntries.memo, total: sql<string>`(select sum(debit) from journal_entry_lines l where l.journal_entry_id = ${s.journalEntries.id})` })
    .from(s.journalEntries)
    .where(and(eq(s.journalEntries.sourceType, "MONEY")))
    .orderBy(desc(s.journalEntries.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, total: toPaise(r.total) }));
}
