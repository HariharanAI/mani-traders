import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";

export function PageHeader({ title, description, actions, back, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "none", icon: Icon, href, money = true, className }: { label: string; value: number; hint?: React.ReactNode; tone?: "none" | "get" | "give" | "brand" | "warn"; icon?: React.ComponentType<{ className?: string }>; href?: string; money?: boolean; className?: string }) {
  const toneText = { none: "text-fg", get: "text-get", give: "text-give", brand: "text-brand", warn: "text-warn" }[tone];
  const toneBg = { none: "bg-surface-3 text-muted", get: "bg-get-soft text-get", give: "bg-give-soft text-give", brand: "bg-brand-soft text-brand", warn: "bg-warn-soft text-warn" }[tone];
  const body = (
    <div className={cn("group h-full rounded-xl border border-border bg-surface p-4 shadow-card transition-colors", href && "hover:border-border-strong", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {Icon ? (
          <span className={cn("grid size-7 place-items-center rounded-lg", toneBg)}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className={cn("tnum mt-2 text-[22px] font-semibold tracking-tight", toneText)}>{money ? formatINR(value, { decimals: Math.abs(value) < 10_000_00 }) : value.toLocaleString("en-IN")}</div>
      {hint ? <div className="mt-1 text-xs text-subtle">{hint}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function BalanceLabel({ value, type = "CUSTOMER" }: { value: number; type?: "CUSTOMER" | "SUPPLIER" }) {
  if (value === 0) return <span className="text-xs font-medium text-subtle">Settled</span>;
  const owesUs = type === "CUSTOMER" ? value > 0 : value < 0;
  return <span className={cn("text-[11px] font-semibold uppercase tracking-wide", owesUs ? "text-get" : "text-give")}>{owesUs ? "You'll get" : "You'll give"}</span>;
}
