"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { changePassword, createOwner, createResetToken, login, logout, resetPasswordWithToken, SESSION_COOKIE, userCount } from "@/server/auth/service";
import { clearSessionCookie, clientIp, getActor, setSessionCookie, toActionError } from "@/server/auth/session";
import { rateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { sendResetEmail } from "@/server/mail";
import type { ActionResult } from "@/lib/utils";

const loginSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")), password: z.string().min(1, "Enter your password").max(200) });

export async function loginAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const input = loginSchema.parse({ email: form.get("email"), password: form.get("password") });
    const ip = (await clientIp()) ?? "local";
    const rl = rateLimit(`login:${ip}`, 20, 15 * 60_000);
    const rl2 = rateLimit(`login:${ip}:${input.email}`, 8, 15 * 60_000);
    if (!rl.ok || !rl2.ok) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(Math.max(rl.retryAfterSec, rl2.retryAfterSec) / 60)} minutes.` };
    const db = await getDb();
    const { token } = await login(db, input.email, input.password, { ip, userAgent: (await headers()).get("user-agent") });
    resetRateLimit(`login:${ip}:${input.email}`);
    await setSessionCookie(token);
  } catch (e) {
    return toActionError(e);
  }
  const next = String(form.get("next") || "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(await getDb(), token);
  await clearSessionCookie();
  redirect("/login");
}

const setupSchema = z.object({
  businessName: z.string().trim().min(2, "Enter the business name").max(120),
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(8, "At least 8 characters"),
  confirm: z.string(),
});

export async function setupAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const input = setupSchema.parse(Object.fromEntries(form));
    if (input.password !== input.confirm) return { ok: false, error: "Passwords do not match", fieldErrors: { confirm: "Does not match" } };
    const db = await getDb();
    if ((await userCount(db)) > 0) return { ok: false, error: "Setup has already been completed. Please sign in." };
    await createOwner(db, input);
    const { token } = await login(db, input.email, input.password, { ip: await clientIp(), userAgent: (await headers()).get("user-agent") });
    await setSessionCookie(token);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/settings?welcome=1");
}

export async function forgotPasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")).parse(form.get("email"));
    const ip = (await clientIp()) ?? "local";
    if (!rateLimit(`forgot:${ip}`, 5, 15 * 60_000).ok) return { ok: false, error: "Too many requests. Please wait a few minutes." };
    const db = await getDb();
    const res = await createResetToken(db, email);
    if (res) {
      const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://${(await headers()).get("host")}`);
      await sendResetEmail(res.user.email, res.user.name, `${base}/reset-password?token=${res.token}`);
    }
    // Same response whether or not the account exists.
    return { ok: true, message: "If an account exists for this email, a reset link has been sent. You can also ask the owner to reset your password." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetPasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const token = String(form.get("token") || "");
    const password = String(form.get("password") || "");
    if (password !== String(form.get("confirm") || "")) return { ok: false, error: "Passwords do not match", fieldErrors: { confirm: "Does not match" } };
    await resetPasswordWithToken(await getDb(), token, password);
    return { ok: true, message: "Password updated. You can now sign in." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changePasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Please sign in again." };
    const next = String(form.get("password") || "");
    if (next !== String(form.get("confirm") || "")) return { ok: false, error: "Passwords do not match", fieldErrors: { confirm: "Does not match" } };
    await changePassword(await getDb(), actor, String(form.get("current") || ""), next, actor.sessionId);
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  } catch (e) {
    return toActionError(e);
  }
}
