import { sql, eq } from "drizzle-orm";
import { createDb, type DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createOwner, loadPermissions } from "@/server/auth/service";
import type { Actor } from "@/server/core";
import { toPaise } from "@/lib/money";

export async function setupDb() {
  const { db, close } = await createDb({ memory: true });
  const user = await createOwner(db, { name: "Test Owner", email: "owner@test.local", password: "secret123", businessName: "MANI TRADERS" });
  const [role] = await db.select().from(s.roles).where(eq(s.roles.key, "OWNER"));
  const actor: Actor = { id: user.id, name: user.name, email: user.email, role: "OWNER", permissions: await loadPermissions(db, role.id, "OWNER") };
  return { db, close, actor };
}

export const key = () => crypto.randomUUID();

/** Sum of balances per account type; for a balanced ledger Σ(debit−credit) over all lines = 0. */
export async function trialBalance(db: DB) {
  const rows = await db.execute<{ code: string; bal: string }>(sql`
    select a.code, coalesce(sum(l.debit - l.credit), 0)::text as bal
    from ledger_accounts a left join journal_entry_lines l on l.account_id = a.id
    group by a.code order by a.code`);
  const list = (rows as unknown as { rows: { code: string; bal: string }[] }).rows ?? (rows as unknown as { code: string; bal: string }[]);
  const map = new Map(list.map((r) => [r.code, toPaise(r.bal)]));
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return { map, total };
}

/** Control account (journal) must equal the sum of khata rows for every party. */
export async function subledgerMismatches(db: DB) {
  const res = await db.execute<{ party_id: string; journal: string; khata: string }>(sql`
    with j as (
      select l.party_type, l.party_id, sum(case when l.party_type = 'CUSTOMER' then l.debit - l.credit else l.credit - l.debit end) as bal
      from journal_entry_lines l join ledger_accounts a on a.id = l.account_id
      where a.code in ('1100','2000') group by 1,2
    ), k as (
      select party_type, party_id, sum(balance_effect) as bal from ledger_transactions group by 1,2
    )
    select coalesce(j.party_id, k.party_id)::text as party_id, coalesce(j.bal,0)::text as journal, coalesce(k.bal,0)::text as khata
    from j full outer join k on j.party_type = k.party_type and j.party_id = k.party_id
    where coalesce(j.bal,0) <> coalesce(k.bal,0)`);
  return ((res as unknown as { rows: unknown[] }).rows ?? res) as { party_id: string; journal: string; khata: string }[];
}
