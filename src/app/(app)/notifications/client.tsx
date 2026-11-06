"use client";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/hooks";
import { markNotificationsReadAction } from "@/app/_actions/business";

export function MarkAllRead() {
  const router = useRouter();
  const { run, pending } = useAction(markNotificationsReadAction);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={async () => {
        const r = await run("all");
        if (r.ok) router.refresh();
      }}
    >
      <CheckCheck /> Mark all read
    </Button>
  );
}
