/**
 * Business dates are calendar dates in Asia/Kolkata, stored as "YYYY-MM-DD".
 * IST has no DST (fixed +05:30), which keeps arithmetic simple and exact.
 */
export const TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
export function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** "2026-11-07" -> "07-11-2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = typeof iso === "string" ? iso.slice(0, 10) : "";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return "—";
  return `${d}-${m}-${y}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-07" -> "07 Nov 2026" */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** Timestamp -> "07-11-2026, 03:45 PM" in IST */
export function formatDateTime(ts: Date | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const date = formatDate(ist.toISOString().slice(0, 10));
  let h = ist.getUTCHours();
  const min = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${date}, ${String(h).padStart(2, "0")}:${min} ${ampm}`;
}

export function timeAgo(ts: Date | string): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10));
}

/** Indian financial year label for a date, e.g. "2026-27" (FY starting April by default). */
export function financialYear(iso: string, startMonth = 4): string {
  const [y, m] = iso.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
export function financialYearRange(iso: string, startMonth = 4): { from: string; to: string } {
  const fy = financialYear(iso, startMonth);
  const startYear = Number(fy.slice(0, 4));
  const from = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  return { from, to: addDays(addMonths(from, 12), -1) };
}

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "prev_month", label: "Previous month" },
  { key: "fy", label: "This financial year" },
  { key: "custom", label: "Custom range" },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export type DateRange = { from: string; to: string; key: RangeKey; label: string };

export function resolveRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  fallback: RangeKey = "30d",
  today = todayIST(),
): DateRange {
  const key = (RANGE_PRESETS.find((r) => r.key === params.range)?.key ?? fallback) as RangeKey;
  const label = RANGE_PRESETS.find((r) => r.key === key)!.label;
  switch (key) {
    case "today":
      return { from: today, to: today, key, label };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y, key, label };
    }
    case "7d":
      return { from: addDays(today, -6), to: today, key, label };
    case "30d":
      return { from: addDays(today, -29), to: today, key, label };
    case "month":
      return { from: startOfMonth(today), to: today, key, label };
    case "prev_month": {
      const p = addMonths(startOfMonth(today), -1);
      return { from: p, to: endOfMonth(p), key, label };
    }
    case "fy":
      return { ...financialYearRange(today), key, label };
    case "custom": {
      let from = params.from && isISODate(params.from) ? params.from : addDays(today, -29);
      let to = params.to && isISODate(params.to) ? params.to : today;
      if (from > to) [from, to] = [to, from];
      return { from, to, key, label: `${formatDate(from)} – ${formatDate(to)}` };
    }
  }
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}
