import Link from "next/link";
import { ResetForm } from "../auth-forms";

export const metadata = { title: "Set new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Signing in again will be required on all devices.</p>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <p className="text-sm text-get">
          This link is missing its token. <Link href="/forgot-password" className="underline">Request a new link</Link>.
        </p>
      )}
    </>
  );
}
