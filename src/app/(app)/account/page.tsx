import { requirePage } from "@/server/auth/session";
import { PageHeader } from "@/components/page";
import { Card, CardHeader } from "@/components/ui";
import { ChangePasswordForm } from "./client";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const actor = await requirePage();
  const mine = PERMISSIONS.filter((p) => actor.role === "OWNER" || actor.permissions.has(p.key));
  return (
    <>
      <PageHeader title="My account" description={`${actor.name} · ${actor.email} · ${actor.role.toLowerCase()}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Change password" description={actor.mustChangePassword ? "You signed in with a temporary password. Please set your own." : "Other devices are signed out after a change."} />
          <div className="p-4 sm:p-5">
            <ChangePasswordForm />
          </div>
        </Card>
        <Card>
          <CardHeader title="What you can do" description="Set by the owner in Employees → Roles" />
          <ul className="grid gap-1 p-4 text-sm sm:grid-cols-2 sm:p-5">
            {mine.map((p) => (
              <li key={p.key} className="text-muted">
                • {p.description}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
