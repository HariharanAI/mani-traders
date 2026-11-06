import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { userCount } from "@/server/auth/service";
import { SetupForm } from "../auth-forms";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if ((await userCount(await getDb())) > 0) redirect("/login");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Set up your business</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Create the owner account. You can add employees after signing in.</p>
      <SetupForm />
    </>
  );
}
