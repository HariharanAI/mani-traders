/**
 * Business settings, employees, roles & permissions, audit log.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import { AppError, assertCan, audit, getSettingsRow, notFound, type Actor } from "../core";
import { hashPassword, passwordProblem, randomToken } from "../auth/password";
import { employeeSchema, gstinStr, emailOpt, phoneStr } from "@/lib/validators";
import { PERMISSIONS, type Permission } from "@/lib/permissions";

export const settingsSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional().nullable(),
  tagline: z.string().trim().max(160).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  state: z.string().trim().max(80).optional().nullable(),
  stateCode: z.string().trim().max(2).optional().nullable(),
  pincode: z.string().trim().max(10).optional().nullable(),
  phone: phoneStr,
  email: emailOpt,
  gstRegistered: z.boolean(),
  gstin: gstinStr,
  gstScheme: z.enum(["REGULAR", "COMPOSITION"]),
  pricesIncludeTax: z.boolean(),
  invoicePrefix: z.string().trim().min(1).max(6).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and - only"),
  receiptPrefix: z.string().trim().min(1).max(6).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and - only"),
  purchasePrefix: z.string().trim().min(1).max(6).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and - only"),
  invoiceTerms: z.string().trim().max(1000).optional().nullable(),
  invoiceFooter: z.string().trim().max(300).optional().nullable(),
  bankDetails: z.string().trim().max(500).optional().nullable(),
  upiId: z.string().trim().max(80).optional().nullable(),
  fyStartMonth: z.coerce.number().int().min(1).max(12),
  creditPeriodDays: z.coerce.number().int().min(1).max(365),
  allowNegativeStock: z.boolean(),
  unusualTxnThreshold: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount"),
  whatsappMode: z.enum(["MANUAL", "CLOUD_API"]),
  whatsappTemplates: z.record(z.string(), z.object({ name: z.string().trim().max(100), language: z.string().trim().max(10) })).optional(),
  notificationPrefs: z.record(z.string(), z.boolean()).optional(),
  backupEnabled: z.boolean(),
  backupRetentionDays: z.coerce.number().int().min(1).max(3650),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export async function getSettings(db: Executor) {
  return getSettingsRow(db);
}

export async function updateSettings(db: DB, actor: Actor, raw: SettingsInput) {
  assertCan(actor, "settings.manage");
  const input = settingsSchema.parse(raw);
  if (input.gstRegistered && !input.gstin) throw new AppError("Enter your GSTIN, or switch off GST registration.", { gstin: "Required when GST registered" });
  return db.transaction(async (tx) => {
    const before = await getSettingsRow(tx);
    const [after] = await tx
      .update(s.businessSettings)
      .set({
        ...input,
        stateCode: input.stateCode || (input.gstin ? input.gstin.slice(0, 2) : null),
        whatsappTemplates: input.whatsappTemplates ?? before.whatsappTemplates,
        notificationPrefs: input.notificationPrefs ?? before.notificationPrefs,
        updatedAt: new Date(),
      })
      .where(eq(s.businessSettings.id, 1))
      .returning();
    await audit(tx, actor, "UPDATE", "settings", "1", "Business settings updated", { before, after });
    return after;
  });
}

export async function setLogo(db: DB, actor: Actor, key: string | null) {
  assertCan(actor, "settings.manage");
  await db.update(s.businessSettings).set({ logoKey: key, updatedAt: new Date() }).where(eq(s.businessSettings.id, 1));
  await audit(db, actor, "UPDATE", "settings", "1", key ? "Logo updated" : "Logo removed");
}

// ---------------------------------------------------------------- employees
export async function listUsers(db: Executor, actor: Actor) {
  assertCan(actor, "employees.manage");
  return db
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      phone: s.users.phone,
      isActive: s.users.isActive,
      lastLoginAt: s.users.lastLoginAt,
      createdAt: s.users.createdAt,
      role: s.roles.key,
      mustChangePassword: s.users.mustChangePassword,
      assignedCustomers: sql<number>`(select count(*)::int from customers c where c.assigned_to = ${s.users.id})`,
    })
    .from(s.users)
    .innerJoin(s.roles, eq(s.roles.id, s.users.roleId))
    .orderBy(asc(s.roles.key), asc(s.users.name));
}

/** Creates a user with a temporary password they must change at first sign-in. */
export async function createEmployee(db: DB, actor: Actor, raw: unknown) {
  assertCan(actor, "employees.manage");
  const input = employeeSchema.parse(raw);
  const tempPassword = input.password?.trim() || `Mt${randomToken(6)}9`;
  const problem = passwordProblem(tempPassword);
  if (problem) throw new AppError(problem, { password: problem });
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${input.email}`);
    if (dup) throw new AppError("A user with this email already exists.", { email: "Already in use" });
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, input.role));
    const [u] = await tx
      .insert(s.users)
      .values({ name: input.name, email: input.email, phone: input.phone, roleId: role.id, passwordHash: await hashPassword(tempPassword), mustChangePassword: true })
      .returning({ id: s.users.id, email: s.users.email });
    await audit(tx, actor, "CREATE", "user", u.id, `User ${input.email} created as ${input.role}`);
    return { id: u.id, tempPassword };
  });
}

export async function updateEmployee(db: DB, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "employees.manage");
  const input = employeeSchema.omit({ password: true }).extend({ isActive: z.boolean() }).parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ u: s.users, role: s.roles.key }).from(s.users).innerJoin(s.roles, eq(s.roles.id, s.users.roleId)).where(eq(s.users.id, id));
    if (!before) throw notFound("User");
    if (before.role === "OWNER") throw new AppError("The owner account cannot be changed here. Use My account.");
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, input.role));
    await tx.update(s.users).set({ name: input.name, email: input.email, phone: input.phone, roleId: role.id, isActive: input.isActive, updatedAt: new Date() }).where(eq(s.users.id, id));
    if (!input.isActive) await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
    await audit(tx, actor, "UPDATE", "user", id, `User ${input.email} updated (${input.role}, ${input.isActive ? "active" : "deactivated"})`, { before: { ...before.u, passwordHash: undefined } });
  });
}

export async function adminResetPassword(db: DB, actor: Actor, id: string) {
  assertCan(actor, "employees.manage");
  const temp = `Mt${randomToken(6)}9`;
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ u: s.users, role: s.roles.key }).from(s.users).innerJoin(s.roles, eq(s.roles.id, s.users.roleId)).where(eq(s.users.id, id));
    if (!u) throw notFound("User");
    if (u.role === "OWNER" && actor.id !== id) throw new AppError("Owner password can only be changed by the owner.");
    await tx.update(s.users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(s.users.id, id));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, id));
    await audit(tx, actor, "PASSWORD_RESET", "user", id, `Temporary password issued for ${u.u.email}`);
  });
  return temp;
}

export async function rolesWithPermissions(db: Executor) {
  const roles = await db.select().from(s.roles).orderBy(asc(s.roles.key));
  const links = await db.select({ roleId: s.rolePermissions.roleId, key: s.permissions.key }).from(s.rolePermissions).innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId));
  return roles.map((r) => ({ ...r, permissions: links.filter((l) => l.roleId === r.id).map((l) => l.key as Permission) }));
}

export async function setRolePermissions(db: DB, actor: Actor, roleKey: "ADMIN" | "EMPLOYEE", keys: string[]) {
  assertCan(actor, "employees.manage");
  const valid = new Set(PERMISSIONS.map((p) => p.key as string));
  const wanted = keys.filter((k) => valid.has(k) && k !== "employees.manage" && k !== "settings.manage");
  await db.transaction(async (tx) => {
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, roleKey));
    if (!role) throw notFound("Role");
    const perms = await tx.select().from(s.permissions);
    const before = await tx.select({ key: s.permissions.key }).from(s.rolePermissions).innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId)).where(eq(s.rolePermissions.roleId, role.id));
    await tx.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, role.id));
    const ids = perms.filter((p) => wanted.includes(p.key)).map((p) => ({ roleId: role.id, permissionId: p.id }));
    if (ids.length) await tx.insert(s.rolePermissions).values(ids);
    await audit(tx, actor, "UPDATE", "role", role.id, `Permissions for ${roleKey} updated`, { before: before.map((b) => b.key), after: wanted });
  });
}

export async function staffOptions(db: Executor) {
  return db
    .select({ id: s.users.id, name: s.users.name, role: s.roles.key })
    .from(s.users)
    .innerJoin(s.roles, eq(s.roles.id, s.users.roleId))
    .where(eq(s.users.isActive, true))
    .orderBy(asc(s.users.name));
}

// ---------------------------------------------------------------- audit log
export async function listAudit(db: Executor, actor: Actor, f: { q?: string; entityType?: string; limit?: number; offset?: number } = {}) {
  assertCan(actor, "audit.view");
  const where = and(
    f.entityType ? eq(s.auditLogs.entityType, f.entityType) : undefined,
    f.q ? or(ilike(s.auditLogs.summary, `%${f.q}%`), ilike(s.auditLogs.action, `%${f.q}%`), ilike(s.users.name, `%${f.q}%`)) : undefined,
  );
  const rows = await db
    .select({ a: s.auditLogs, user: s.users.name })
    .from(s.auditLogs)
    .leftJoin(s.users, eq(s.users.id, s.auditLogs.userId))
    .where(where)
    .orderBy(desc(s.auditLogs.createdAt))
    .limit(f.limit ?? 100)
    .offset(f.offset ?? 0);
  return rows.map((r) => ({ ...r.a, user: r.user }));
}
