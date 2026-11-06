import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { buildReport, defaultReportRange, REPORTS, type ReportKey } from "@/server/services/reports";
import { getCustomerForActor, getSupplier, partySummary } from "@/server/services/parties";
import { PageHeader } from "@/components/page";
import { RangeFilter, SearchBox } from "@/components/filters";
import { Card, EmptyState } from "@/components/ui";
import { ExportButtons, ReportPartyPicker, ReportTable } from "./client";
import { formatINR, formatQty } from "@/lib/money";
import { resolveRange } from "@/lib/dates";
import { cn } from "@/lib/utils";

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const def = REPORTS.find((r) => r.key === key);
  if (!def) notFound();
  const isStatement = "needsParty" in def;
  const actor = await requirePage(isStatement ? "ledger.view" : "reports.view");
  const sp = await searchParams;
  const db = await getDb();
  const range = sp.range ? resolveRange(sp) : defaultReportRange(key as ReportKey);
  let partyName: string | null = null;
  let partyBalance = 0;
  if (isStatement && sp.party) {
    try {
      partyName = (def.needsParty === "CUSTOMER" ? await getCustomerForActor(db, actor, sp.party) : await getSupplier(db, actor, sp.party)).name;
      partyBalance = (await partySummary(db, { type: def.needsParty as "CUSTOMER" | "SUPPLIER", id: sp.party })).balance;
    } catch {
      partyName = null;
    }
  }
  const report = await buildReport(db, actor, key as ReportKey, range, { partyId: partyName ? sp.party : undefined, q: sp.q });
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const searchable = ["customer-outstanding", "supplier-payable", "inventory-valuation", "stock-movement"].includes(key);
  return (
    <>
      <PageHeader back={{ href: "/reports", label: "Reports" }} title={report.title} description={report.subtitle} actions={<ExportButtons href={`/api/reports/${key}?${qs}`} />} />
      <Card className="mb-4 flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center no-print">
        {def.needsRange ? <RangeFilter defaultRange={key === "monthly-sales" ? "fy" : "month"} /> : null}
        {isStatement ? <ReportPartyPicker type={def.needsParty as "CUSTOMER" | "SUPPLIER"} selected={partyName ? { id: sp.party!, name: partyName, balance: partyBalance } : null} /> : null}
        {searchable ? <SearchBox placeholder="Filter by name" className="sm:max-w-xs sm:flex-1" /> : null}
        {!def.needsRange && !isStatement && !searchable ? <span className="px-1 text-sm text-muted">Current position — no date filter needed.</span> : null}
      </Card>
      {report.summary?.length ? (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.summary.map((s) => (
            <Card key={s.label} className="p-4">
              <div className="text-xs text-muted">{s.label}</div>
              <div className={cn("tnum mt-1 text-xl font-semibold", s.tone === "pos" && "text-give", s.tone === "neg" && "text-get")}>{s.kind === "money" ? formatINR(s.value) : s.kind === "qty" ? formatQty(s.value) : s.value.toLocaleString("en-IN")}</div>
            </Card>
          ))}
        </div>
      ) : null}
      <Card>
        {report.columns.length === 0 || report.rows.length === 0 ? (
          <EmptyState title={report.columns.length === 0 ? "Choose what to report on" : "No records for this period"} description={report.note} />
        ) : (
          <ReportTable columns={report.columns} rows={report.rows} totals={report.totals} />
        )}
      </Card>
      {report.note && report.rows.length ? <p className="mt-3 text-xs text-muted">{report.note}</p> : null}
    </>
  );
}
