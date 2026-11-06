import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Executor } from "../db/client";
import * as s from "../db/schema";
import { getSettingsRow, type Actor } from "../core";

export const NOTIFICATION_TYPES = [
  { key: "PAYMENT_RECEIVED", label: "Customer payment received" },
  { key: "CREDIT_GIVEN", label: "New credit transaction" },
  { key: "OVERDUE", label: "Overdue customer balance" },
  { key: "LOW_STOCK", label: "Low inventory" },
  { key: "PURCHASE", label: "New purchase" },
  { key: "SALE", label: "New sale" },
  { key: "UNUSUAL", label: "Unusual transaction" },
  { key: "DAILY_SUMMARY", label: "Daily business summary" },
  { key: "REVERSAL", label: "Reversals and cancellations" },
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["key"];

export async function notify(
  tx: Executor,
  n: {
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
    severity?: "info" | "success" | "warning" | "danger";
    audience?: "OWNER" | "MANAGERS" | "ALL";
    dedupeKey?: string;
  },
) {
  const settings = await getSettingsRow(tx);
  if (settings.notificationPrefs?.[n.type] === false) return;
  await tx
    .insert(s.notifications)
    .values({
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      severity: n.severity ?? "info",
      audience: n.audience ?? "OWNER",
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

function audiencesFor(actor: Actor): string[] {
  if (actor.role === "OWNER") return ["OWNER", "MANAGERS", "ALL"];
  if (actor.role === "ADMIN") return ["MANAGERS", "ALL"];
  return ["ALL"];
}

export async function listNotifications(db: Executor, actor: Actor, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const rows = await db
    .select({ n: s.notifications, readAt: s.notificationReads.readAt })
    .from(s.notifications)
    .leftJoin(
      s.notificationReads,
      and(eq(s.notificationReads.notificationId, s.notifications.id), eq(s.notificationReads.userId, actor.id)),
    )
    .where(
      and(
        inArray(s.notifications.audience, audiencesFor(actor)),
        opts.unreadOnly ? isNull(s.notificationReads.readAt) : undefined,
      ),
    )
    .orderBy(desc(s.notifications.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({ ...r.n, readAt: r.readAt }));
}

export async function unreadCount(db: Executor, actor: Actor): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.notifications)
    .leftJoin(
      s.notificationReads,
      and(eq(s.notificationReads.notificationId, s.notifications.id), eq(s.notificationReads.userId, actor.id)),
    )
    .where(and(inArray(s.notifications.audience, audiencesFor(actor)), isNull(s.notificationReads.readAt)));
  return r.n;
}

export async function markRead(db: Executor, actor: Actor, ids: string[] | "all") {
  let targetIds: string[];
  if (ids === "all") {
    const rows = await listNotifications(db, actor, { unreadOnly: true, limit: 1000 });
    targetIds = rows.map((r) => r.id);
  } else targetIds = ids;
  if (!targetIds.length) return;
  await db
    .insert(s.notificationReads)
    .values(targetIds.map((id) => ({ notificationId: id, userId: actor.id })))
    .onConflictDoNothing();
}
