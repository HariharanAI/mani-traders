/**
 * System reference data. Idempotent: inserts what is missing, never touches
 * business data and never creates demo transactions.
 */
import { sql } from "drizzle-orm";
import type { DB } from "./client";
import * as s from "./schema";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, ROLES } from "../../lib/permissions";
import { CHART_OF_ACCOUNTS } from "../../lib/accounts";

export async function seedSystemData(db: DB) {
  await db.transaction(async (tx) => {
    // Roles
    for (const r of ROLES) {
      await tx.insert(s.roles).values({ key: r.key, name: r.name, description: r.description }).onConflictDoNothing();
    }
    // Permissions
    const permCountBefore = await tx.select({ n: sql<number>`count(*)::int` }).from(s.permissions);
    for (const p of PERMISSIONS) {
      await tx
        .insert(s.permissions)
        .values({ key: p.key, group: p.group, description: p.description })
        .onConflictDoUpdate({ target: s.permissions.key, set: { group: p.group, description: p.description } });
    }
    // Default role permissions only for permissions that are new (so owner edits are preserved)
    const roleRows = await tx.select().from(s.roles);
    const permRows = await tx.select().from(s.permissions);
    const existingLinks = await tx.select().from(s.rolePermissions);
    const firstRun = permCountBefore[0].n === 0;
    for (const role of roleRows) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.key as keyof typeof DEFAULT_ROLE_PERMISSIONS] ?? [];
      for (const key of defaults) {
        const perm = permRows.find((p) => p.key === key);
        if (!perm) continue;
        const has = existingLinks.some((l) => l.roleId === role.id && l.permissionId === perm.id);
        const isNewPermission = firstRun || !existingLinks.some((l) => l.permissionId === perm.id);
        if (!has && isNewPermission) {
          await tx.insert(s.rolePermissions).values({ roleId: role.id, permissionId: perm.id }).onConflictDoNothing();
        }
      }
    }
    // Chart of accounts
    for (const a of CHART_OF_ACCOUNTS) {
      await tx.insert(s.ledgerAccounts).values({ code: a.code, name: a.name, type: a.type, isSystem: true }).onConflictDoNothing();
    }
    // Settings singleton
    await tx.insert(s.businessSettings).values({ id: 1 }).onConflictDoNothing();
    // Default product categories
    const cats = await tx.select({ n: sql<number>`count(*)::int` }).from(s.productCategories);
    if (cats[0].n === 0) {
      for (const name of ["General"]) await tx.insert(s.productCategories).values({ name }).onConflictDoNothing();
    }
  });
}
