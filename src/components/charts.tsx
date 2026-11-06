"use client";
/**
 * Dashboard charts (Recharts). Palette validated for CVD/contrast in light and
 * dark (see --chart-1..3 in globals.css). One y-axis per chart, thin rounded
 * bars with surface gaps, recessive grid, hover tooltip, legend for >=2 series,
 * and a table view for every chart.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";
import { formatINR, formatINRCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

type Series = { key: string; label: string; color: string; kind?: "bar" | "line" };

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          {s.kind === "line" ? <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} /> : <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />}
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: string; series: Series[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs shadow-pop">
      <div className="mb-1.5 font-semibold text-fg">{label}</div>
      {series.map((s) => {
        const p = payload.find((x) => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum font-medium text-fg">{formatINR(p.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function DataTable({ rows, series, xKey, xLabel }: { rows: Record<string, number | string>[]; series: Series[]; xKey: string; xLabel: string }) {
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-muted">
            <th className="py-2 pr-3 text-left font-medium">{xLabel}</th>
            {series.map((s) => (
              <th key={s.key} className="py-2 pl-3 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[xKey])} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-3">{r[xKey]}</td>
              {series.map((s) => (
                <td key={s.key} className="tnum py-1.5 pl-3 text-right">
                  {formatINR(Number(r[s.key]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartCard({ title, description, series, rows, xKey, xLabel, height = 240, children }: { title: string; description?: string; series: Series[]; rows: Record<string, number | string>[]; xKey: string; xLabel: string; height?: number; children: React.ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("grid size-7 place-items-center rounded-md", view === v ? "bg-surface-3 text-fg" : "text-subtle hover:text-fg")} aria-label={v === "chart" ? "Chart view" : "Table view"} aria-pressed={view === v}>
              {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2">
        <Legend series={series} />
      </div>
      {view === "chart" ? <div style={{ height }}>{children}</div> : <DataTable rows={rows} series={series} xKey={xKey} xLabel={xLabel} />}
    </div>
  );
}

const axis = { stroke: "var(--fg-subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function DailySalesChart({ data }: { data: { label: string; sales: number; collections: number }[] }) {
  const series: Series[] = [
    { key: "sales", label: "Sales (excl. GST)", color: "var(--chart-1)" },
    { key: "collections", label: "Collections", color: "var(--chart-2)" },
  ];
  const tickEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <ChartCard title="Daily sales & collections" description="Sales are billed revenue; collections are money received." series={series} rows={data} xKey="label" xLabel="Date">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap={data.length > 20 ? "20%" : "30%"} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axis} interval={tickEvery - 1} />
          <YAxis {...axis} width={56} tickFormatter={(v) => formatINRCompact(v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip series={series} />} />
          <Bar dataKey="sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="collections" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={18} stroke="var(--surface)" strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function MonthlyRevenueChart({ data }: { data: { label: string; revenue: number; profit: number; expenses: number }[] }) {
  const series: Series[] = [
    { key: "revenue", label: "Revenue", color: "var(--chart-1)" },
    { key: "profit", label: "Profit estimate", color: "var(--chart-3)", kind: "line" },
  ];
  return (
    <ChartCard title="Monthly revenue" description="Last 12 months · profit = revenue − cost of goods − expenses" series={series} rows={data} xKey="label" xLabel="Month">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axis} minTickGap={12} interval="preserveStartEnd" />
          <YAxis {...axis} width={56} tickFormatter={(v) => formatINRCompact(v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip series={series} />} />
          <Bar dataKey="revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line dataKey="profit" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--chart-3)" }} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CollectionsChart({ data }: { data: { label: string; creditGiven: number; collected: number }[] }) {
  const series: Series[] = [
    { key: "creditGiven", label: "Credit given", color: "var(--chart-2)" },
    { key: "collected", label: "Collected", color: "var(--chart-1)" },
  ];
  return (
    <ChartCard title="Collections vs credit given" description="Customer khata · last 12 months" series={series} rows={data} xKey="label" xLabel="Month" height={220}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axis} minTickGap={12} interval="preserveStartEnd" />
          <YAxis {...axis} width={56} tickFormatter={(v) => formatINRCompact(v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip series={series} />} />
          <Bar dataKey="creditGiven" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
          <Bar dataKey="collected" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
