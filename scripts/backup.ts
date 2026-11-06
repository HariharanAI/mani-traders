/**
 * Creates a database backup in BACKUP_DIR and prunes old ones per the
 * retention setting.
 *
 *   npm run db:backup
 *
 * PostgreSQL: uses pg_dump (custom format; restore with pg_restore).
 * Embedded DB: writes a gzip'd data-directory archive (stop the app first).
 */
import "dotenv/config";
import { createDb, databaseUrl } from "../src/server/db/client";
import { createBackup, backupDir } from "../src/server/services/jobs";

async function main() {
  const { db, close } = await createDb({ url: databaseUrl() });
  try {
    const name = await createBackup(db);
    console.log(`Backup written: ${backupDir()}/${name}`);
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
