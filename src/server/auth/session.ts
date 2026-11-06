import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db";
import { actorFromToken, SESSION_COOKIE } from "./service";
import { AppError, can, type Actor } from "../core";
import type { Permission } from "@/lib/permissions";
import type { ActionResult } from "@/lib/utils";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Current signed-in actor, or null. Memoised per request. */
export const getActor = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  return actorFromToken(db, token, await clientIp());
});

/** For pages/layouts: redirects to /login when signed out, and to / when forbidden. */
export async function requirePage(...perms: Permission[]) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  for (const p of perms) if (!can(actor, p)) redirect("/forbidden");
  return actor;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
    path: "/",
    maxAge: 30 * 24 * 3600, // the server-side session expiry is authoritative
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Wraps a server action: authenticates, checks permissions, maps errors to a
 * serialisable ActionResult. Unexpected errors are logged, never leaked.
 */
export async function runAction<T>(
  perms: Permission[],
  fn: (actor: Actor) => Promise<T | ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Your session has expired. Please sign in again." };
    for (const p of perms) if (!can(actor, p)) return { ok: false, error: "You do not have permission to do this." };
    const out = await fn(actor);
    if (out && typeof out === "object" && "ok" in (out as object)) return out as ActionResult<T>;
    return { ok: true, data: out as T };
  } catch (e) {
    return toActionError(e);
  }
}

export function toActionError(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const fieldErrors: Record<string, string> = {};
    for (const i of issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: issues[0]?.message ?? "Please check the form.", fieldErrors };
  }
  // Re-throw Next.js control-flow errors (redirect / notFound)
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/duplicate key value.*idempotency_key/i.test(msg)) return { ok: false, error: "This entry was already submitted." };
  if (/not balanced|immutable/i.test(msg)) {
    console.error("[integrity]", e);
    return { ok: false, error: "The ledger rejected this change to protect financial integrity." };
  }
  console.error("[action error]", e);
  return { ok: false, error: "Something went wrong. Please try again." };
}
