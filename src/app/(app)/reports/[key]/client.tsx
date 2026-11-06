"use client";
import { FileSpreadsheet, FileText, Printer, Sheet } from "lucide-react";
import { Button, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { PartyPicker } from "@/components/forms";
import { useUrlParams } from "@/components/filters";
import { formatINR, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";

type Col = { key: string; label: string; kind: string };
type Row = Record<string, string | number | null>;

function cell(v: Row[string], kind: string) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "money") return formatINR(v);
  if (kind === "qty") return formatQty(v);
  if (kind === "percent") return `${v}%`;
  return v.toLocaleString("en-IN");
}

export function ReportTable({ columns, rows, totals }: { columns: Col[]; rows: Row[]; totals?: Row }) {
  const right = (k: string) => k !== "text" && k !== "date";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted", right(c.kind) ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-border last:border-0 hover:bg-surface-2/50", r.bold ? "bg-surface-2/60 font-semibold" : "")}>
              {columns.map((c) => {
                const v = r[c.key];
                const neg = typeof v === "number" && v < 0 && c.kind === "money";
                return (
                  <td key={c.key} className={cn("px-4 py-2.5", right(c.kind) ? "tnum whitespace-nowrap text-right" : "", neg && "text-get")}>
                    {cell(v, c.kind)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-t-2 border-border-strong bg-surface-2 font-semibold">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-3", right(c.kind) ? "tnum whitespace-nowrap text-right" : "")}>
                  {cell(totals[c.key], c.kind)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function ExportButtons({ href }: { href: string }) {
  const sep = href.includes("?") ? "&" : "?";
  return (
    <div className="flex gap-2 no-print">
      <Button variant="secondary" onClick={() => window.print()}>
        <Printer /> Print
      </Button>
      <Menu>
        <MenuTrigger asChild>
          <Button>
            <FileText /> Export
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => window.open(`${href}${sep}format=pdf`, "_blank")}>
            <FileText /> PDF
          </MenuItem>
          <MenuItem onSelect={() => (window.location.href = `${href}${sep}format=xlsx`)}>
            <FileSpreadsheet /> Excel (.xlsx)
          </MenuItem>
          <MenuItem onSelect={() => (window.location.href = `${href}${sep}format=csv`)}>
            <Sheet /> CSV
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

export function ReportPartyPicker({ type, selected }: { type: "CUSTOMER" | "SUPPLIER"; selected: { id: string; name: string; balance: number } | null }) {
  const { set } = useUrlParams();
  return (
    <div className="w-full sm:w-80">
      <PartyPicker type={type} value={selected ? { ...selected, mobile: null, code: "" } : null} onChange={(p) => set({ party: p?.id ?? null })} placeholder={`Select ${type === "CUSTOMER" ? "customer" : "supplier"}`} />
    </div>
  );
}
