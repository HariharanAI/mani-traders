import Link from "next/link";
import { after } from "next/server";
import { KeyRound } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getSettingsRow, can } from "@/server/core";
import { unreadCount } from "@/server/services/notifications";
import { listCategories } from "@/server/services/inventory";
import { staffOptions } from "@/server/services/admin";
import { runDailyJobs } from "@/server/services/jobs";
import { AppShell } from "@/components/shell";
import { todayIST } from "@/lib/dates";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePage();
  const db = await getDb();
  const [settings, unread, categories] = await Promise.all([getSettingsRow(db), unreadCount(db, actor), listCategories(db)]);
  const staff = can(actor, "customers.view_all") && can(actor, "customers.manage") ? await staffOptions(db) : [];
  // Daily jobs (overdue alerts, summary, backup) run once per IST day, after the response is sent.
  if (actor.role === "OWNER" && settings.lastDailyJobDate !== todayIST()) {
    after(async () => {
      try {
        await runDailyJobs(db);
      } catch (e) {
        console.error("[daily jobs]", e);
      }
    });
  }
  return (
    <AppShell
      user={{ name: actor.name, email: actor.email, role: actor.role }}
      permissions={[...actor.permissions]}
      business={settings.businessName}
      unread={unread}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      gstEnabled={settings.gstRegistered && settings.gstScheme === "REGULAR"}
      staff={staff.filter((s) => s.role !== "OWNER").map((s) => ({ id: s.id, name: s.name }))}
    >
      {actor.mustChangePassword ? (
        <Link href="/account" className="mb-4 flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <KeyRound className="size-4 shrink-0" />
          <span>
            You are using a temporary password. <b>Set your own password now →</b>
          </span>
        </Link>
      ) : null}
      <div className="page-enter">{children}</div>
    </AppShell>
  );
}
