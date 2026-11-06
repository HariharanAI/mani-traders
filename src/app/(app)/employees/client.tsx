"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Pencil, ShieldCheck, UserPlus } from "lucide-react";
import { Avatar, Badge, Button, Card, CardHeader, Dialog, DialogContent, DialogFooter, Field, Input, Segmented, Select, Switch } from "@/components/ui";
import { useAction } from "@/components/hooks";
import { createEmployeeAction, resetEmployeePasswordAction, setRolePermissionsAction, updateEmployeeAction } from "@/app/_actions/business";
import { timeAgo } from "@/lib/dates";

type User = { id: string; name: string; email: string; phone: string | null; isActive: boolean; lastLoginAt: string | null; role: string; mustChangePassword: boolean; assignedCustomers: number };
type Role = { key: string; name: string; description: string | null; permissions: string[] };
type Perm = { key: string; group: string; description: string };

export function EmployeesClient({ users, roles, permissions, meId }: { users: User[]; roles: Role[]; permissions: Perm[]; meId: string }) {
  const [tab, setTab] = useState<"people" | "roles">("people");
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const reset = useAction(resetEmployeePasswordAction);
  const router = useRouter();
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: "people", label: "People" }, { value: "roles", label: "Roles & permissions" }]} />
        {tab === "people" ? (
          <Button onClick={() => setEditing("new")}>
            <UserPlus /> Add employee
          </Button>
        ) : null}
      </div>
      {tab === "people" ? (
        <Card>
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    <Badge tone={u.role === "OWNER" ? "brand" : u.role === "ADMIN" ? "info" : "neutral"}>{u.role.toLowerCase()}</Badge>
                    {!u.isActive ? <Badge tone="get">Deactivated</Badge> : null}
                    {u.mustChangePassword ? <Badge tone="warn">Temp password</Badge> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {u.email}
                    {u.phone ? ` · ${u.phone}` : ""} · {u.lastLoginAt ? `Last sign-in ${timeAgo(u.lastLoginAt)}` : "Never signed in"}
                    {u.role === "EMPLOYEE" ? ` · ${u.assignedCustomers} assigned customers` : ""}
                  </div>
                </div>
                {u.role !== "OWNER" ? (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={reset.pending}
                      onClick={async () => {
                        if (!confirm(`Issue a new temporary password for ${u.name}? They will be signed out everywhere.`)) return;
                        const r = await reset.run(u.id);
                        if (r.ok) {
                          setTemp({ email: u.email, password: r.data!.tempPassword });
                          router.refresh();
                        }
                      }}
                    >
                      <KeyRound /> Reset password
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(u)}>
                      <Pencil /> Edit
                    </Button>
                  </div>
                ) : u.id === meId ? (
                  <span className="text-xs text-muted">You</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <RolesEditor roles={roles} permissions={permissions} />
      )}
      <EmployeeDialog user={editing} onClose={() => setEditing(null)} onCreated={(email, password) => setTemp({ email, password })} />
      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent title="Temporary password" description="Share this privately. It is shown only once; the employee must change it at first sign-in.">
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="text-xs text-muted">Email</div>
              <div className="font-medium">{temp?.email}</div>
              <div className="mt-3 text-xs text-muted">Password</div>
              <div className="font-mono text-lg font-semibold tracking-wide">{temp?.password}</div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(`Email: ${temp?.email}\nPassword: ${temp?.password}`);
                toast.success("Copied");
              }}
            >
              <Copy /> Copy details
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmployeeDialog({ user, onClose, onCreated }: { user: User | "new" | null; onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const router = useRouter();
  const isNew = user === "new";
  const [f, setF] = useState({ name: "", email: "", phone: "", role: "EMPLOYEE", isActive: true, password: "" });
  useEffect(() => {
    if (user && user !== "new") setF({ name: user.name, email: user.email, phone: user.phone ?? "", role: user.role, isActive: user.isActive, password: "" });
    else if (user === "new") setF({ name: "", email: "", phone: "", role: "EMPLOYEE", isActive: true, password: "" });
  }, [user]);
  const create = useAction(createEmployeeAction);
  const update = useAction(updateEmployeeAction);
  const errs = { ...create.fieldErrors, ...update.fieldErrors };
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? "Add employee" : "Edit employee"}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (isNew) {
              const r = await create.run({ name: f.name, email: f.email, phone: f.phone || null, role: f.role, password: f.password || undefined });
              if (r.ok) {
                onCreated(f.email, r.data!.tempPassword);
                onClose();
                router.refresh();
              }
            } else {
              const r = await update.run((user as User).id, { name: f.name, email: f.email, phone: f.phone || null, role: f.role, isActive: f.isActive });
              if (r.ok) {
                toast.success("Employee updated");
                onClose();
                router.refresh();
              }
            }
          }}
        >
          <Field label="Name" required error={errs.name}>
            <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email (sign-in)" required error={errs.email}>
              <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label="Phone" error={errs.phone}>
              <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" />
            </Field>
          </div>
          <Field label="Role">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="EMPLOYEE">Employee — counter sales & payments</option>
              <option value="ADMIN">Admin — manages customers, stock, transactions</option>
            </Select>
          </Field>
          {isNew ? (
            <Field label="Initial password (optional)" hint="Leave empty to generate one. They must change it at first sign-in." error={errs.password}>
              <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} type="text" autoComplete="off" />
            </Field>
          ) : (
            <Switch checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" description="Deactivated users cannot sign in and are signed out immediately." />
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending}>
              <Check /> {isNew ? "Create account" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RolesEditor({ roles, permissions }: { roles: Role[]; permissions: Perm[] }) {
  const router = useRouter();
  const editable = roles.filter((r) => r.key !== "OWNER");
  const [sel, setSel] = useState<Record<string, Set<string>>>(() => Object.fromEntries(editable.map((r) => [r.key, new Set(r.permissions)])));
  const save = useAction(setRolePermissionsAction);
  const groups = [...new Set(permissions.map((p) => p.group))];
  const locked = new Set(["employees.manage", "settings.manage"]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {editable.map((role) => (
        <Card key={role.key}>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-brand" /> {role.name}
              </span>
            }
            description={role.description}
            action={
              <Button
                size="sm"
                loading={save.pending}
                onClick={async () => {
                  const r = await save.run(role.key as "ADMIN" | "EMPLOYEE", [...sel[role.key]]);
                  if (r.ok) {
                    toast.success(`${role.name} permissions saved`);
                    router.refresh();
                  }
                }}
              >
                Save
              </Button>
            }
          />
          <div className="space-y-4 p-4 sm:p-5">
            {groups.map((g) => (
              <div key={g}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{g}</div>
                <div className="space-y-1">
                  {permissions
                    .filter((p) => p.group === g)
                    .map((p) => (
                      <label key={p.key} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2 ${locked.has(p.key) ? "opacity-50" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[var(--brand)]"
                          disabled={locked.has(p.key)}
                          checked={sel[role.key].has(p.key)}
                          onChange={(e) =>
                            setSel((s) => {
                              const next = new Set(s[role.key]);
                              if (e.target.checked) next.add(p.key);
                              else next.delete(p.key);
                              return { ...s, [role.key]: next };
                            })
                          }
                        />
                        <span>{p.description}</span>
                      </label>
                    ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-subtle">Employee management and business settings are reserved for the owner.</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
