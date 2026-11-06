/**
 * Authentication service (framework-agnostic: no Next.js imports, so it is testable).
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/client";
import * as s from "../db/schema";
import { hashPassword, passwordProblem, randomToken, sha256, verifyPassword } from "./password";
import { AppError, audit, type Actor } from "../core";
import type { Permission, RoleKey } from "@/lib/permissions";
import { PERMISSIONS } from "@/lib/permissions";

export const SESSION_COOKIE = "mt_session";
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const sessionTtlMs = () => Number(process.env.SESSION_TTL_HOURS || 12) * 3600 * 1000;

export async function userCount(db: Executor): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  return r.n;
}

export async function loadPermissions(db: Executor, roleId: string, roleKey: string): Promise<Set<Permission>> {
  if (roleKey === "OWNER") return new Set(PERMISSIONS.map((p) => p.key));
  const rows = await db
    .select({ key: s.permissions.key })
    .from(s.rolePermissions)
    .innerJoin(s.permissions, eq(s.permissions.id, s.rolePermissions.permissionId))
    .where(eq(s.rolePermissions.roleId, roleId));
  return new Set(rows.map((r) => r.key as Permission));
}

export async function createOwner(db: DB, input: { name: string; email: string; password: string; businessName?: string }) {
  const problem = passwordProblem(input.password);
  if (problem) throw new AppError(problem, { password: problem });
  return db.transaction(async (tx) => {
    // Serialise first-run setup: only possible while there are no users.
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
    if ((await userCount(tx)) > 0) throw new AppError("Setup has already been completed.", undefined, "CONFLICT");
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, "OWNER"));
    const [user] = await tx
      .insert(s.users)
      .values({ name: input.name.trim(), email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password), roleId: role.id })
      .returning();
    if (input.businessName?.trim()) {
      await tx.update(s.businessSettings).set({ businessName: input.businessName.trim(), updatedAt: new Date() }).where(eq(s.businessSettings.id, 1));
    }
    await audit(tx, null, "SETUP", "user", user.id, `Owner account created for ${user.email}`);
    return user;
  });
}

export async function login(db: DB, email: string, password: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${normalized}`);
  const generic = new AppError("Incorrect email or password.");
  if (!user) {
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "=="); // equalise timing
    throw generic;
  }
  if (!user.isActive) throw new AppError("This account has been deactivated. Contact the owner.");
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("Too many failed attempts. Try again in a few minutes.");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(s.users)
      .set({
        failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
      })
      .where(eq(s.users.id, user.id));
    await audit(db, null, "LOGIN_FAILED", "user", user.id, `Failed login for ${user.email}`);
    throw generic;
  }
  const token = randomToken();
  await db.transaction(async (tx) => {
    await tx.insert(s.sessions).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + sessionTtlMs()),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    });
    await tx.update(s.users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(s.users.id, user.id));
    await audit(tx, { id: user.id, ip: meta.ip } as Actor, "LOGIN", "user", user.id, `${user.email} signed in`);
  });
  return { token, user };
}

export async function actorFromToken(db: DB, token: string, ip?: string | null): Promise<(Actor & { mustChangePassword: boolean; sessionId: string }) | null> {
  const hash = sha256(token);
  const [row] = await db
    .select({ session: s.sessions, user: s.users, roleKey: s.roles.key })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .innerJoin(s.roles, eq(s.roles.id, s.users.roleId))
    .where(and(eq(s.sessions.tokenHash, hash), gt(s.sessions.expiresAt, new Date())));
  if (!row || !row.user.isActive) return null;
  // Sliding expiration, written at most once a minute.
  if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
    await db
      .update(s.sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + sessionTtlMs()) })
      .where(eq(s.sessions.id, row.session.id));
  }
  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.roleKey as RoleKey,
    permissions: await loadPermissions(db, row.user.roleId, row.roleKey),
    ip: ip ?? null,
    mustChangePassword: row.user.mustChangePassword,
    sessionId: row.session.id,
  };
}

export async function logout(db: DB, token: string) {
  await db.delete(s.sessions).where(eq(s.sessions.tokenHash, sha256(token)));
}

export async function changePassword(db: DB, actor: Actor, current: string, next: string, keepSessionId?: string) {
  const [user] = await db.select().from(s.users).where(eq(s.users.id, actor.id));
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AppError("Current password is incorrect.", { current: "Incorrect password" });
  const problem = passwordProblem(next);
  if (problem) throw new AppError(problem, { password: problem });
  await db.transaction(async (tx) => {
    await tx.update(s.users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() }).where(eq(s.users.id, actor.id));
    // Sign out every other session.
    await tx.delete(s.sessions).where(and(eq(s.sessions.userId, actor.id), keepSessionId ? sql`${s.sessions.id} <> ${keepSessionId}` : sql`true`));
    await audit(tx, actor, "PASSWORD_CHANGED", "user", actor.id, "Password changed");
  });
}

/** Creates a single-use reset token valid for 30 minutes. Returns null for unknown emails (caller must not reveal this). */
export async function createResetToken(db: DB, email: string): Promise<{ token: string; user: typeof s.users.$inferSelect } | null> {
  const [user] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${email.trim().toLowerCase()}`);
  if (!user || !user.isActive) return null;
  const token = randomToken();
  await db.insert(s.passwordResetTokens).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60000) });
  await audit(db, null, "PASSWORD_RESET_REQUESTED", "user", user.id, `Password reset requested for ${user.email}`);
  return { token, user };
}

export async function resetPasswordWithToken(db: DB, token: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, { password: problem });
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.passwordResetTokens)
      .where(and(eq(s.passwordResetTokens.tokenHash, sha256(token)), isNull(s.passwordResetTokens.usedAt), gt(s.passwordResetTokens.expiresAt, new Date())))
      .for("update");
    if (!row) throw new AppError("This reset link is invalid or has expired.");
    await tx.update(s.passwordResetTokens).set({ usedAt: new Date() }).where(eq(s.passwordResetTokens.id, row.id));
    await tx.update(s.users).set({ passwordHash: await hashPassword(password), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false, updatedAt: new Date() }).where(eq(s.users.id, row.userId));
    await tx.delete(s.sessions).where(eq(s.sessions.userId, row.userId));
    await audit(tx, null, "PASSWORD_RESET", "user", row.userId, "Password reset via link");
  });
}
