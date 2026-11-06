"use client";
/**
 * MANI TRADERS UI primitives. Small, consistent, accessible.
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, X, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";

// ---------------------------------------------------------------- Button
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background,color,border,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-fg hover:bg-brand-hover shadow-card",
        secondary: "bg-surface border border-border-strong text-fg hover:bg-surface-2 shadow-card",
        ghost: "text-muted hover:text-fg hover:bg-surface-2",
        danger: "bg-get text-white hover:opacity-90 shadow-card",
        get: "bg-get text-white hover:opacity-90 shadow-card",
        give: "bg-give text-white hover:opacity-90 shadow-card",
        link: "text-brand hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, loading, children, disabled, ...props }, ref) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Inputs
const fieldBase =
  "w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-colors focus:border-brand focus:outline-none focus:ring-3 focus:ring-[var(--ring)] disabled:opacity-60 aria-[invalid=true]:border-get";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a928b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...props}>
      {children}
    </select>
  );
});

/** Money input: decimal keyboard on mobile, ₹ prefix. Value is a plain string. */
export function MoneyInput({ value, onChange, className, autoFocus, size = "md", ...rest }: { value: string; onChange: (v: string) => void; className?: string; autoFocus?: boolean; size?: "md" | "lg"; id?: string; name?: string; placeholder?: string; "aria-invalid"?: boolean; disabled?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle", size === "lg" ? "text-xl" : "text-sm")}>₹</span>
      <input
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        className={cn(fieldBase, "tnum", size === "lg" ? "h-14 pl-8 text-2xl font-semibold" : "h-10 pl-7")}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          if (/^\d*(\.\d{0,2})?$/.test(v)) onChange(v);
        }}
        placeholder="0"
        {...rest}
      />
    </div>
  );
}

export function Field({ label, error, hint, children, className, required, htmlFor }: { label?: React.ReactNode; error?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string; required?: boolean; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">
          {label}
          {required ? <span className="text-get"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-xs text-get">{error}</p> : hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; description?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "opacity-60")}>
      <span>
        {label ? <span className="block text-sm font-medium">{label}</span> : null}
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-brand" : "bg-surface-3 border border-border-strong")}
      >
        <span className={cn("absolute top-1/2 size-4.5 -translate-y-1/2 rounded-full bg-white shadow transition-all", checked ? "left-5" : "left-0.5")} />
      </button>
    </label>
  );
}

/** Segmented control */
export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; tone?: "get" | "give" }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex rounded-lg border border-border bg-surface-2 p-0.5", className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-md font-medium transition-all",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              active ? (o.tone === "get" ? "bg-get text-white shadow-card" : o.tone === "give" ? "bg-give text-white shadow-card" : "bg-surface text-fg shadow-card") : "text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface shadow-card", className)} {...props}>
      {children}
    </div>
  );
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "get" | "give" | "warn" | "info" | "brand"; className?: string }) {
  const tones = {
    neutral: "bg-surface-3 text-muted",
    get: "bg-get-soft text-get",
    give: "bg-give-soft text-give",
    warn: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
    brand: "bg-brand-soft text-brand",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <Icon className="size-6" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Avatar({ name, className, tone }: { name: string; className?: string; tone?: "get" | "give" | "neutral" }) {
  const init = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  return <div className={cn("grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold", tone === "get" ? "bg-get-soft text-get" : tone === "give" ? "bg-give-soft text-give" : "bg-brand-soft text-brand", className)}>{init}</div>;
}

/** Money with semantic colour. tone="auto": positive = get (owes us), negative = give. */
export function Money({ value, className, tone = "none", decimals = true, abs = false }: { value: number; className?: string; tone?: "none" | "auto" | "get" | "give" | "invert"; decimals?: boolean; abs?: boolean }) {
  let color = "";
  if (tone === "get") color = "text-get";
  else if (tone === "give") color = "text-give";
  else if (tone === "auto") color = value > 0 ? "text-get" : value < 0 ? "text-give" : "text-muted";
  else if (tone === "invert") color = value > 0 ? "text-give" : value < 0 ? "text-get" : "text-muted";
  return <span className={cn("tnum", color, className)}>{formatINR(abs ? Math.abs(value) : value, { decimals })}</span>;
}

// ---------------------------------------------------------------- Dialog / Sheet
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, side = "center", wide }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string; side?: "center" | "right" | "bottom"; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content
        onOpenAutoFocus={(e) => {
          // let the first autofocus input win; avoid focusing the close button
          const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[autofocus], input, select, textarea");
          if (el) {
            e.preventDefault();
            el.focus();
          }
        }}
        className={cn(
          "fixed z-50 flex max-h-[100dvh] flex-col border border-border bg-surface shadow-pop focus:outline-none",
          side === "center" && "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl data-[state=open]:animate-up",
          side === "center" && (wide ? "sm:max-w-3xl" : "sm:max-w-lg"),
          side === "right" && "inset-y-0 right-0 w-full max-w-md data-[state=open]:animate-up",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl data-[state=open]:animate-up",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="-mr-1 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("sticky bottom-0 -mx-5 -mb-4 mt-5 flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-3 sm:flex-row sm:justify-end", className)}>{children}</div>;
}

// ---------------------------------------------------------------- Menu
export const Menu = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;
export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content align={align} sideOffset={6} className={cn("z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop data-[state=open]:animate-in", className)}>
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, className, disabled }: { children: React.ReactNode; onSelect?: () => void; danger?: boolean; className?: string; disabled?: boolean }) {
  return (
    <Dropdown.Item disabled={disabled} onSelect={onSelect} className={cn("flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-subtle", danger && "text-get [&_svg]:text-get", className)}>
      {children}
    </Dropdown.Item>
  );
}
export const MenuSeparator = () => <Dropdown.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <Dropdown.Label className="px-2.5 py-1.5 text-xs font-medium text-subtle">{children}</Dropdown.Label>;

// ---------------------------------------------------------------- Table
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_thead_tr]:border-b [&_thead_tr]:border-border [&_tbody_tr]:border-b [&_tbody_tr]:border-border [&_tbody_tr:last-child]:border-0 [&_tbody_tr]:transition-colors">
        {children}
      </table>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-subtle", className)} />;
}
