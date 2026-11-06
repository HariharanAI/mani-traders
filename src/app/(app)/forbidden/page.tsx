import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, EmptyState, Button } from "@/components/ui";

export default function Forbidden() {
  return (
    <Card>
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description="Ask the owner to update your permissions in Employees → Roles."
        action={
          <Link href="/">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        }
      />
    </Card>
  );
}
