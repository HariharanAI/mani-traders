/**
 * Applies database migrations and seeds system data (roles, permissions,
 * chart of accounts). Safe to run repeatedly.
 *
 *   npm run db:migrate
 *
 * Uses DATABASE_URL / POSTGRES_URL when set, otherwise the local embedded
 * database in PGLITE_DIR. (Stop `npm run dev` first when using the embedded DB —
 * it can only be opened by one process at a time.)
 */
import "dotenv/config";
import { createDb, databaseUrl } from "../src/server/db/client";

async function main() {
  const url = databaseUrl();
  console.log(`Migrating ${url ? "PostgreSQL" : `embedded database at ${process.env.PGLITE_DIR || "./data/pglite"}`} …`);
  const { close } = await createDb({ url });
  await close();
  console.log("Database is up to date.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
