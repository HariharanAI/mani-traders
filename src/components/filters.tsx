"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { RANGE_PRESETS } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Input, Select, Spinner } from "./ui";

export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in updates)) next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { sp, set, pending };
}

export function SearchBox({ placeholder = "Search…", param = "q", className, autoFocus }: { placeholder?: string; param?: string; className?: string; autoFocus?: boolean }) {
  const { sp, set, pending } = useUrlParams();
  const [value, setValue] = useState(sp.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="pl-9 pr-9" autoFocus={autoFocus} type="search" />
      <span className="absolute right-3 top-1/2 -translate-y-1/2">
        {pending ? (
          <Spinner />
        ) : value ? (
          <button type="button" onClick={() => setValue("")} className="text-subtle hover:text-fg" aria-label="Clear search">
            <X className="size-4" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function SelectFilter({ param, options, className, label }: { param: string; options: { value: string; label: string }[]; className?: string; label?: string }) {
  const { sp, set } = useUrlParams();
  return (
    <Select aria-label={label ?? param} className={cn("w-auto min-w-36", className)} value={sp.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value || null })}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function RangeFilter({ defaultRange = "30d", className, presets }: { defaultRange?: string; className?: string; presets?: string[] }) {
  const { sp, set, pending } = useUrlParams();
  const range = sp.get("range") ?? defaultRange;
  const list = presets ? RANGE_PRESETS.filter((p) => presets.includes(p.key)) : RANGE_PRESETS;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative">
        <CalendarRange className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Select aria-label="Date range" className="w-auto min-w-44 pl-9" value={range} onChange={(e) => set({ range: e.target.value, from: null, to: null })}>
          {list.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      {range === "custom" ? (
        <>
          <Input type="date" aria-label="From date" className="w-auto" defaultValue={sp.get("from") ?? ""} onChange={(e) => e.target.value && set({ range: "custom", from: e.target.value, to: sp.get("to") })} />
          <span className="text-sm text-subtle">to</span>
          <Input type="date" aria-label="To date" className="w-auto" defaultValue={sp.get("to") ?? ""} onChange={(e) => e.target.value && set({ range: "custom", to: e.target.value, from: sp.get("from") })} />
        </>
      ) : null}
      {pending ? <Spinner /> : null}
    </div>
  );
}

export function Pagination({ total, pageSize, page }: { total: number; pageSize: number; page: number }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const n = new URLSearchParams(sp.toString());
    n.set("page", String(p));
    return `${pathname}?${n.toString()}`;
  };
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Link aria-disabled={page <= 1} href={href(Math.max(1, page - 1))} className={cn("grid size-8 place-items-center rounded-md border border-border hover:bg-surface-2", page <= 1 && "pointer-events-none opacity-40")} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Link>
        <Link aria-disabled={page >= pages} href={href(Math.min(pages, page + 1))} className={cn("grid size-8 place-items-center rounded-md border border-border hover:bg-surface-2", page >= pages && "pointer-events-none opacity-40")} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
