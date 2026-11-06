import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { listNotifications } from "@/server/services/notifications";
import { listMessages } from "@/server/services/whatsapp";
import { PageHeader } from "@/components/page";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { MarkAllRead } from "./client";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

const ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: OctagonAlert } as const;
const TONE = { info: "bg-info-soft text-info", success: "bg-give-soft text-give", warning: "bg-warn-soft text-warn", danger: "bg-get-soft text-get" } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const actor = await requirePage();
  const { filter } = await searchParams;
  const db = await getDb();
  const items = await listNotifications(db, actor, { unreadOnly: filter === "unread", limit: 200 });
  const messages = can(actor, "messages.send") ? await listMessages(db, actor, { limit: 30 }) : [];
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifications"
        description={actor.role === "OWNER" ? "Choose which alerts you get in Settings → Notifications." : undefined}
        actions={
          <>
            <Link href={filter === "unread" ? "/notifications" : "/notifications?filter=unread"} className="text-sm font-medium text-brand">
              {filter === "unread" ? "Show all" : "Unread only"}
            </Link>
            {unread ? <MarkAllRead /> : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={Bell} title={filter === "unread" ? "You're all caught up" : "No notifications yet"} description="Payments, sales, low stock and overdue alerts will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const Icon = ICON[n.severity as keyof typeof ICON] ?? Info;
                const body = (
                  <div className={cn("flex gap-3 px-4 py-3.5", !n.readAt && "bg-brand-soft/40")}>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", TONE[n.severity as keyof typeof TONE] ?? TONE.info)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("text-sm", !n.readAt ? "font-semibold" : "font-medium")}>{n.title}</span>
                        <span className="shrink-0 text-xs text-subtle" title={formatDateTime(n.createdAt)}>
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      {n.body ? <p className="mt-0.5 text-sm text-muted">{n.body}</p> : null}
                    </div>
                  </div>
                );
                return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-surface-2/60">{body}</Link> : body}</li>;
              })}
            </ul>
          )}
        </Card>
        {can(actor, "messages.send") ? (
          <Card className="h-fit">
            <CardHeader title="WhatsApp message log" description="Status comes from WhatsApp itself; manual shares are only marked as opened" />
            {messages.length ? (
              <ul className="divide-y divide-border px-4 py-2">
                {messages.map((m) => (
                  <li key={m.id} className="py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{m.partyName ?? m.toNumber}</span>
                      <Badge tone={m.status === "FAILED" ? "get" : m.status === "READ" || m.status === "DELIVERED" ? "give" : m.status === "SENT" ? "info" : "neutral"}>{m.status === "MANUAL_OPENED" ? "opened" : m.status.toLowerCase()}</Badge>
                    </div>
                    <div className="text-xs text-muted">
                      {m.messageType.replace(/_/g, " ").toLowerCase()} · {m.mode === "CLOUD_API" ? "API" : "manual"} · {timeAgo(m.createdAt)}
                    </div>
                    {m.error ? <div className="mt-0.5 text-xs text-get">{m.error}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No messages yet.</p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
