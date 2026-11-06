/**
 * Scheduled work: overdue reminders to the owner, the daily business summary
 * and automatic backups. Idempotent per IST date; triggered by
 * /api/cron/daily (external scheduler) and lazily when the owner opens the app.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { getSettingsRow, type Actor } from "../core";
import { PERMISSIONS } from "@/lib/permissions";
import { formatINR, toPaise } from "@/lib/money";
import { addDays, formatDate, todayIST } from "@/lib/dates";
import { notify } from "./notifications";
import { overdueCustomers } from "./reports";

const systemActor: Actor = { id: "00000000-0000-0000-0000-000000000000", name: "System", email: "system", role: "OWNER", permissions: new Set(PERMISSIONS.map((p) => p.key)) };

export async function runDailyJobs(db: DB, opts: { force?: boolean } = {}) {
  const today = todayIST();
  const settings = await getSettingsRow(db);
  if (!opts.force && settings.lastDailyJobDate === today) return { skipped: true };
  // claim the day atomically so concurrent triggers don't double-run
  const claimed = await db
    .update(s.businessSettings)
    .set({ lastDailyJobDate: today })
    .where(and(eq(s.businessSettings.id, 1), opts.force ? undefined : sql`${s.businessSettings.lastDailyJobDate} is distinct from ${today}`))
    .returning({ id: s.businessSettings.id });
  if (!claimed.length) return { skipped: true };

  // 1) Daily summary for yesterday
  const y = addDays(today, -1);
  const [sales] = await db.select({ n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${s.sales.grandTotal}),0)` }).from(s.sales).where(and(eq(s.sales.status, "ACTIVE"), eq(s.sales.saleDate, y)));
  const [coll] = await db.select({ v: sql<string>`coalesce(sum(${s.payments.amount}),0)` }).from(s.payments).where(and(eq(s.payments.status, "ACTIVE"), eq(s.payments.direction, "IN"), eq(s.payments.paymentDate, y)));
  const [exp] = await db.select({ v: sql<string>`coalesce(sum(${s.expenses.amount}),0)` }).from(s.expenses).where(and(eq(s.expenses.status, "ACTIVE"), gte(s.expenses.expenseDate, y), lte(s.expenses.expenseDate, y)));
  if (sales.n > 0 || toPaise(coll.v) > 0 || toPaise(exp.v) > 0) {
    await notify(db, {
      type: "DAILY_SUMMARY",
      title: `Daily summary for ${formatDate(y)}`,
      body: `Sales ${formatINR(toPaise(sales.v))} (${sales.n} invoices) · Collected ${formatINR(toPaise(coll.v))} · Expenses ${formatINR(toPaise(exp.v))}`,
      link: `/?range=yesterday`,
      dedupeKey: `daily:${y}`,
    });
  }

  // 2) Overdue customers (one notification per customer per week)
  const overdue = await overdueCustomers(db, systemActor, 500);
  const week = `${today.slice(0, 4)}-w${Math.floor((Number(today.slice(5, 7)) * 31 + Number(today.slice(8, 10))) / 7)}`;
  for (const c of overdue.slice(0, 50)) {
    await notify(db, {
      type: "OVERDUE",
      title: `${c.name} is overdue: ${formatINR(c.balance)}`,
      body: `No payment for ${c.daysSincePayment} days (credit period ${settings.creditPeriodDays} days).`,
      link: `/customers/${c.id}`,
      severity: "warning",
      audience: "MANAGERS",
      dedupeKey: `overdue:${c.id}:${week}`,
    });
  }

  // 3) Backup
  let backup: string | null = null;
  if (settings.backupEnabled) {
    try {
      backup = await createBackup(db);
    } catch (e) {
      console.error("[backup] failed", e);
      await notify(db, { type: "DAILY_SUMMARY", title: "Automatic backup failed", body: (e as Error).message, severity: "danger", dedupeKey: `backupfail:${today}` });
    }
  }
  return { skipped: false, overdue: overdue.length, backup };
}

// ---------------------------------------------------------------- backups
export function backupDir() {
  return path.resolve(process.env.BACKUP_DIR || "./backups");
}

export async function createBackup(db: DB): Promise<string> {
  const dir = backupDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  let file: string;
  if (process.env.DATABASE_URL) {
    file = path.join(dir, `mani-traders-${stamp}.dump`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn("pg_dump", ["--format=custom", "--no-owner", `--file=${file}`, process.env.DATABASE_URL!], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", (e) => reject(new Error(`pg_dump not available: ${e.message}`)));
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exited ${code}: ${err.slice(0, 300)}`))));
    });
  } else {
    const client = (db as unknown as { $client: { dumpDataDir: (c?: "gzip" | "none") => Promise<Blob> } }).$client;
    const blob = await client.dumpDataDir("gzip");
    file = path.join(dir, `mani-traders-${stamp}.pglite.tar.gz`);
    await fs.writeFile(file, Buffer.from(await blob.arrayBuffer()));
  }
  const settings = await getSettingsRow(db);
  await db.update(s.businessSettings).set({ lastBackupAt: new Date() }).where(eq(s.businessSettings.id, 1));
  // retention
  const cutoff = Date.now() - settings.backupRetentionDays * 86400000;
  for (const f of await fs.readdir(dir)) {
    if (!f.startsWith("mani-traders-")) continue;
    const st = await fs.stat(path.join(dir, f));
    if (st.mtimeMs < cutoff) await fs.unlink(path.join(dir, f));
  }
  return path.basename(file);
}

export async function listBackups() {
  const dir = backupDir();
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("mani-traders-"));
    const out = await Promise.all(files.map(async (f) => ({ name: f, size: (await fs.stat(path.join(dir, f))).size, at: (await fs.stat(path.join(dir, f))).mtime })));
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  } catch {
    return [];
  }
}
