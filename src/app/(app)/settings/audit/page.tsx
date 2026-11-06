import { History } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAudit } from "@/server/services/admin";
import { PageHeader } from "@/components/page";
import { SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const actor = await requirePage("audit.view");
  const sp = await searchParams;
  const rows = await listAudit(await getDb(), actor, { q: sp.q, entityType: sp.type, limit: 300 });
  const types = ["customer", "supplier", "ledger_transaction", "payment", "sale", "purchase", "product", "expense", "user", "role", "settings"];
  return (
    <>
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="Audit log" description="Every change to business data, who made it and when. Entries cannot be edited or deleted." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <SearchBox placeholder="Search actions, users, details" className="sm:max-w-sm sm:flex-1" />
          <SelectFilter param="type" options={[{ value: "", label: "All records" }, ...types.map((t) => ({ value: t, label: t.replace("_", " ") }))]} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={History} title="No audit entries" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-40 shrink-0 text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={/REVERSE|CANCEL|VOID|DELETE|FAILED/.test(r.action) ? "warn" : r.action === "CREATE" ? "give" : "neutral"}>{r.action.replace(/_/g, " ").toLowerCase()}</Badge>
                    <span className="text-sm">{r.summary}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-subtle">
                    {r.user ?? "System"} · {r.entityType}
                    {r.ip ? ` · ${r.ip}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
