import Link from "next/link";
import { History } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getSettingsRow } from "@/server/core";
import { cloudConfigured, MESSAGE_TYPES } from "@/server/services/whatsapp";
import { listBackups } from "@/server/services/jobs";
import { storageDriverName } from "@/server/storage";
import { databaseUrl } from "@/server/db/client";
import { NOTIFICATION_TYPES } from "@/server/services/notifications";
import { PageHeader } from "@/components/page";
import { Button } from "@/components/ui";
import { SettingsForm } from "./client";
import { CashBook } from "./cashbook";
import { listCashEntries, moneyBalances } from "@/server/services/cashbook";
import { financialYear, todayIST } from "@/lib/dates";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string; tab?: string }> }) {
  const actor = await requirePage("settings.manage");
  const sp = await searchParams;
  const db = await getDb();
  const settings = await getSettingsRow(db);
  const [backups, balances, cashEntries] = await Promise.all([listBackups(), moneyBalances(db), listCashEntries(db)]);
  const appUrl = process.env.APP_URL || "";
  return (
    <>
      <PageHeader
        title="Settings"
        description={sp.welcome ? "Welcome! Start by adding your business details — they appear on invoices and receipts." : "Business profile, billing, WhatsApp and data safety"}
        actions={
          actor.role === "OWNER" ? (
            <Link href="/settings/audit">
              <Button variant="secondary">
                <History /> Audit log
              </Button>
            </Link>
          ) : null
        }
      />
      <SettingsForm
        initialTab={sp.tab}
        settings={{ ...settings, unusualTxnThreshold: settings.unusualTxnThreshold, lastBackupAt: settings.lastBackupAt?.toISOString() ?? null }}
        currentFy={financialYear(todayIST(), settings.fyStartMonth)}
        whatsapp={{ configured: cloudConfigured(), webhookUrl: appUrl ? `${appUrl.replace(/\/$/, "")}/api/whatsapp/webhook` : "/api/whatsapp/webhook", verifyTokenSet: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, appSecretSet: !!process.env.WHATSAPP_APP_SECRET }}
        messageTypes={MESSAGE_TYPES.map((m) => ({ key: m.key, label: m.label, params: m.params }))}
        notificationTypes={NOTIFICATION_TYPES.map((n) => ({ key: n.key, label: n.label }))}
        backups={backups.map((b) => ({ name: b.name, size: b.size, at: b.at.toISOString() }))}
        cashbook={<CashBook balances={balances} entries={cashEntries} />}
        storage={{ driver: storageDriverName(), db: databaseUrl() ? "PostgreSQL" : "Embedded PostgreSQL (PGlite)" }}
      />
    </>
  );
}
