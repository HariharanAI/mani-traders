import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listUsers, rolesWithPermissions } from "@/server/services/admin";
import { PageHeader } from "@/components/page";
import { EmployeesClient } from "./client";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const actor = await requirePage("employees.manage");
  const db = await getDb();
  const [users, roles] = await Promise.all([listUsers(db, actor), rolesWithPermissions(db)]);
  return (
    <>
      <PageHeader title="Employees & access" description="Who can sign in, and what each role is allowed to do" />
      <EmployeesClient
        meId={actor.id}
        users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() }))}
        roles={roles.map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: r.permissions }))}
        permissions={PERMISSIONS.map((p) => ({ key: p.key, group: p.group, description: p.description }))}
      />
    </>
  );
}
