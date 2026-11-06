import "server-only";
import { getDb as getDbInternal, type DB } from "./client";

export type { DB, Tx } from "./client";

export function getDb(): Promise<DB> {
  return getDbInternal();
}
