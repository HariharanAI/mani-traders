"use client";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Field, Input } from "@/components/ui";
import { changePasswordAction } from "@/app/_actions/auth";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      form.current?.reset();
      router.refresh();
    } else if (state && !state.ok) toast.error(state.error);
  }, [state, router]);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form ref={form} action={action} className="space-y-4">
      <Field label="Current password" error={fe.current}>
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="8+ characters with letters and numbers" error={fe.password}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm new password" error={fe.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" loading={pending}>
        Update password
      </Button>
    </form>
  );
}
