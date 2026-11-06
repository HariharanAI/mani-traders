"use client";
import { AlertOctagon } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /not found/i.test(error.message);
  return (
    <Card>
      <EmptyState
        icon={AlertOctagon}
        title={notFound ? "Record not found" : "This page could not be loaded"}
        description={notFound ? "It may not exist, or you may not have access to it." : `Please try again. ${error.digest ? `Reference: ${error.digest}` : ""}`}
        action={<Button variant="secondary" onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
