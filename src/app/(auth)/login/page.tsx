import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { userCount } from "@/server/auth/service";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if ((await userCount(await getDb())) === 0) redirect("/setup");
  if (await getActor()) redirect("/");
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Sign in to continue to your business ledger.</p>
      <LoginForm next={next} />
    </>
  );
}
