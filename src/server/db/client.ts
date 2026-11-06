/**
 * Database client. Uses PostgreSQL via `pg` when DATABASE_URL is set, otherwise
 * an embedded PostgreSQL (PGlite) persisted to PGLITE_DIR. Both share one schema
 * and one set of SQL migrations.
 */
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";
import { runMigrations } from "./migrate";

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the root db or a transaction. */
export type Executor = DB | Tx;

type Holder = { promise?: Promise<DB>; close?: () => Promise<void> };
const g = globalThis as unknown as { __maniDb?: Holder };
const holder: Holder = (g.__maniDb ??= {});

export async function createDb(opts: { url?: string; dir?: string; memory?: boolean; migrate?: boolean } = {}) {
  let db: DB;
  let close: () => Promise<void>;
  const url = opts.memory ? undefined : opts.url;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
    db = drizzle(pool, { schema }) as unknown as DB;
    close = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    let client;
    if (opts.memory) {
      client = new PGlite();
    } else {
      const dir = path.resolve(opts.dir ?? process.env.PGLITE_DIR ?? "./data/pglite");
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    db = drizzle(client, { schema }) as unknown as DB;
    close = () => client.close();
  }
  if (opts.migrate !== false) await runMigrations(db, url ? "pg" : "pglite");
  return { db, close };
}

export function getDb(): Promise<DB> {
  if (!holder.promise) {
    holder.promise = createDb({ url: process.env.DATABASE_URL || undefined }).then(({ db, close }) => {
      holder.close = close;
      return db;
    });
    holder.promise.catch(() => {
      holder.promise = undefined;
    });
  }
  return holder.promise;
}
