"use client";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/utils";

/** Runs a server action with pending state, error toasts and field errors. */
export function useAction<A extends unknown[], T>(action: (...args: A) => Promise<ActionResult<T>>) {
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const run = useCallback(
    (...args: A) =>
      new Promise<ActionResult<T>>((resolve) => {
        start(async () => {
          setFieldErrors({});
          let res: ActionResult<T>;
          try {
            res = await action(...args);
          } catch {
            res = { ok: false, error: "Network error. Check your connection and try again." };
          }
          if (!res.ok) {
            setFieldErrors(res.fieldErrors ?? {});
            toast.error(res.error);
          }
          resolve(res);
        });
      }),
    [action],
  );
  return { run, pending, fieldErrors, setFieldErrors };
}

/** A fresh idempotency key per form session; call reset() after a successful submit. */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return { key, reset: () => setKey(crypto.randomUUID()) };
}
