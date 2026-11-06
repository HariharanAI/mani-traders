"use client";
import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { forgotPasswordAction, loginAction, resetPasswordAction, setupAction } from "@/app/_actions/auth";
import type { ActionResult } from "@/lib/utils";

function ErrorBox({ state }: { state: ActionResult | null }) {
  if (!state || state.ok) return null;
  return <div className="rounded-lg border border-get/30 bg-get-soft px-3 py-2 text-sm text-get">{state.error}</div>;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <ErrorBox state={state} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Sign in
      </Button>
      <div className="text-center text-sm">
        <Link href="/forgot-password" className="text-brand hover:underline">
          Forgot password?
        </Link>
      </div>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <ErrorBox state={state} />
      <Field label="Business name" error={fe.businessName}>
        <Input name="businessName" defaultValue="MANI TRADERS" required />
      </Field>
      <Field label="Your name" error={fe.name}>
        <Input name="name" required autoFocus />
      </Field>
      <Field label="Email (used to sign in)" error={fe.email}>
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" hint="8+ characters with letters and numbers" error={fe.password}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password" error={fe.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Create owner account
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  if (state?.ok)
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-give/30 bg-give-soft p-4 text-sm text-give">
          <CheckCircle2 className="size-5 shrink-0" /> {state.message}
        </div>
        <Link href="/login" className="block text-center text-sm text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <ErrorBox state={state} />
      <Field label="Email">
        <Input name="email" type="email" required autoFocus />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-muted hover:text-fg">
        Back to sign in
      </Link>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  if (state?.ok)
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-give/30 bg-give-soft p-4 text-sm text-give">
          <CheckCircle2 className="size-5 shrink-0" /> {state.message}
        </div>
        <Link href="/login" className="block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </div>
    );
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <ErrorBox state={state} />
      <Field label="New password" hint="8+ characters with letters and numbers" error={fe.password}>
        <Input name="password" type="password" autoComplete="new-password" required autoFocus />
      </Field>
      <Field label="Confirm password" error={fe.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        Set new password
      </Button>
    </form>
  );
}
