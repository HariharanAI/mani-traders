"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BarChart3,
  Bell,
  BookOpenText,
  Boxes,
  ChevronRight,
  CircleUser,
  FileText,
  Home,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  X,
  Laptop,
  Loader2,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Avatar, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "./ui";
import { CustomerDialog, ExpenseDialog, PaymentDialog, ProductDialog } from "./forms";
import { logoutAction } from "@/app/_actions/auth";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/money";
import type { Permission } from "@/lib/permissions";

type ShellUser = { name: string; email: string; role: string };
type ShellCtx = {
  permissions: Set<Permission>;
  can: (p: Permission) => boolean;
  quick: (k: QuickKind) => void;
  categories: { id: string; name: string }[];
  gstEnabled: boolean;
  staff: { id: string; name: string }[];
};
type QuickKind = "customer" | "sale" | "payment" | "expense" | "purchase" | "product";
const Ctx = createContext<ShellCtx | null>(null);
export const useShell = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell outside AppShell");
  return c;
};

const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: Permission | Permission[] }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users, perm: "customers.view" },
  { href: "/khata", label: "Khata / Ledger", icon: BookOpenText, perm: "ledger.view" },
  { href: "/sales", label: "Sales", icon: ShoppingCart, perm: "sales.view" },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag, perm: "purchases.view" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, perm: "suppliers.view" },
  { href: "/payments", label: "Payments", icon: Wallet, perm: ["payments.receive", "payments.make"] },
  { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory.view" },
  { href: "/expenses", label: "Expenses", icon: Receipt, perm: "expenses.view" },
  { href: "/invoices", label: "Invoices", icon: FileText, perm: "sales.view" },
  { href: "/reports", label: "Reports", icon: BarChart3, perm: "reports.view" },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/employees", label: "Employees", icon: UserCog, perm: "employees.manage" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "settings.manage" },
];

const QUICK: { kind: QuickKind; label: string; icon: React.ComponentType<{ className?: string }>; perm: Permission; tone: string }[] = [
  { kind: "sale", label: "Add sale", icon: ShoppingCart, perm: "sales.create", tone: "bg-brand-soft text-brand" },
  { kind: "payment", label: "Receive payment", icon: IndianRupee, perm: "payments.receive", tone: "bg-give-soft text-give" },
  { kind: "customer", label: "Add customer", icon: UserPlus, perm: "customers.manage", tone: "bg-info-soft text-info" },
  { kind: "expense", label: "Add expense", icon: Receipt, perm: "expenses.manage", tone: "bg-get-soft text-get" },
  { kind: "purchase", label: "Add purchase", icon: ShoppingBag, perm: "purchases.create", tone: "bg-warn-soft text-warn" },
  { kind: "product", label: "Add product", icon: Package, perm: "inventory.manage", tone: "bg-surface-3 text-fg" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ user, permissions, business, unread, categories, gstEnabled, staff, children }: { user: ShellUser; permissions: Permission[]; business: string; unread: number; categories: { id: string; name: string }[]; gstEnabled: boolean; staff: { id: string; name: string }[]; children: React.ReactNode }) {
  const perms = useMemo(() => new Set(permissions), [permissions]);
  const can = (p: Permission) => user.role === "OWNER" || perms.has(p);
  const allowed = (perm?: Permission | Permission[]) => !perm || (Array.isArray(perm) ? perm.some(can) : can(perm));
  const nav = NAV.filter((n) => allowed(n.perm));
  const quickItems = QUICK.filter((q) => can(q.perm));
  const pathname = usePathname();
  const router = useRouter();
  const [dialog, setDialog] = useState<QuickKind | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const quick = (k: QuickKind) => {
    setQuickOpen(false);
    setMoreOpen(false);
    if (k === "sale") router.push("/sales/new");
    else if (k === "purchase") router.push("/purchases/new");
    else setDialog(k);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <Ctx.Provider value={{ permissions: perms, can, quick, categories, gstEnabled, staff }}>
      <div className="min-h-dvh lg:pl-64">
        {/* ------------------------------------------------ desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
          <div className="flex h-16 items-center gap-3 px-5">
            <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-fg shadow-card">
              <BookOpenText className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold tracking-tight">{business}</div>
              <div className="text-[11px] text-subtle">Business ledger</div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
            {nav.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link key={n.href} href={n.href} className={cn("group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors", active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                  <n.icon className={cn("size-[18px]", active ? "text-brand" : "text-subtle group-hover:text-fg")} />
                  <span className="flex-1">{n.label}</span>
                  {n.href === "/notifications" && unread > 0 ? <span className="rounded-full bg-get px-1.5 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-border p-3">
            <UserMenu user={user} />
          </div>
        </aside>

        {/* ------------------------------------------------ top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:h-16 sm:px-6">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <div className="grid size-8 place-items-center rounded-lg bg-brand text-brand-fg">
                <BookOpenText className="size-4" />
              </div>
              <span className="text-sm font-bold tracking-tight">{business}</span>
            </Link>
            <button onClick={() => setPaletteOpen(true)} className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-subtle shadow-card transition-colors hover:border-border-strong sm:w-80 lg:ml-0" aria-label="Search">
              <Search className="size-4" />
              <span className="hidden flex-1 text-left sm:inline">Search customers, invoices, products…</span>
              <span className="hidden sm:inline">
                <Kbd>Ctrl K</Kbd>
              </span>
            </button>
            <div className="hidden flex-1 lg:block" />
            {quickItems.length ? (
              <Menu>
                <MenuTrigger asChild>
                  <button className="hidden h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-brand-fg shadow-card hover:bg-brand-hover sm:inline-flex">
                    <Plus className="size-4" /> New
                  </button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>Quick actions</MenuLabel>
                  {quickItems.map((q) => (
                    <MenuItem key={q.kind} onSelect={() => quick(q.kind)}>
                      <q.icon /> {q.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : null}
            <Link href="/notifications" className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
              <Bell className="size-[18px]" />
              {unread > 0 ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-get ring-2 ring-bg" /> : null}
            </Link>
            <ThemeToggle />
            <div className="lg:hidden">
              <UserMenu user={user} compact />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:pb-12">{children}</main>

        {/* ------------------------------------------------ mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          <div className="grid grid-cols-5">
            {[
              { href: "/", label: "Home", icon: Home, show: true },
              { href: "/customers", label: "Customers", icon: Users, show: can("customers.view") },
              { href: "/khata", label: "Khata", icon: BookOpenText, show: can("ledger.view") },
              { href: "/reports", label: "Reports", icon: BarChart3, show: can("reports.view") },
            ]
              .filter((x) => x.show)
              .concat(can("reports.view") ? [] : [{ href: "/sales", label: "Sales", icon: ShoppingCart, show: true }])
              .slice(0, 4)
              .map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active ? "text-brand" : "text-subtle")}>
                    <n.icon className="size-5" />
                    {n.label}
                  </Link>
                );
              })}
            <button onClick={() => setMoreOpen(true)} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", moreOpen ? "text-brand" : "text-subtle")}>
              <MenuIcon className="size-5" /> More
            </button>
          </div>
        </nav>
        {quickItems.length ? (
          <button onClick={() => setQuickOpen(true)} className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-2xl bg-brand text-brand-fg shadow-pop transition-transform active:scale-95 lg:hidden" aria-label="Quick actions">
            <Plus className="size-6" />
          </button>
        ) : null}

        {/* quick action sheet (mobile) */}
        <BottomSheet open={quickOpen} onOpenChange={setQuickOpen} title="Quick actions">
          <div className="grid grid-cols-3 gap-3">
            {quickItems.map((q) => (
              <button key={q.kind} onClick={() => quick(q.kind)} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-3 text-center text-xs font-medium active:scale-95">
                <span className={cn("grid size-11 place-items-center rounded-xl", q.tone)}>
                  <q.icon className="size-5" />
                </span>
                {q.label}
              </button>
            ))}
          </div>
        </BottomSheet>
        {/* more sheet (mobile) */}
        <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} title="All sections">
          <div className="grid grid-cols-3 gap-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-1.5 rounded-xl p-3 text-center text-xs font-medium", isActive(pathname, n.href) ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2")}>
                <n.icon className="size-5" />
                {n.label}
              </Link>
            ))}
            <Link href="/account" className="flex flex-col items-center gap-1.5 rounded-xl p-3 text-center text-xs font-medium text-muted hover:bg-surface-2">
              <CircleUser className="size-5" /> My account
            </Link>
          </div>
        </BottomSheet>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} nav={nav} quick={quickItems} onQuick={quick} />

        <CustomerDialog open={dialog === "customer"} onOpenChange={(o) => !o && setDialog(null)} staff={staff} onSaved={(c) => router.push(`/customers/${c.id}`)} />
        <PaymentDialog open={dialog === "payment"} onOpenChange={(o) => !o && setDialog(null)} canMake={can("payments.make")} canReceive={can("payments.receive")} />
        <ExpenseDialog open={dialog === "expense"} onOpenChange={(o) => !o && setDialog(null)} />
        <ProductDialog open={dialog === "product"} onOpenChange={(o) => !o && setDialog(null)} categories={categories} gstEnabled={gstEnabled} />
      </div>
    </Ctx.Provider>
  );
}

function BottomSheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in" />
        <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-surface px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-pop data-[state=open]:animate-up">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
          <div className="mb-4 flex items-center justify-between">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            <DialogPrimitive.Close className="rounded-md p-1 text-subtle" aria-label="Close">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const Icon = !mounted ? Sun : theme === "dark" ? Moon : theme === "light" ? Sun : Laptop;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Theme">
          <Icon className="size-[18px]" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => setTheme("light")}>
          <Sun /> Light
        </MenuItem>
        <MenuItem onSelect={() => setTheme("dark")}>
          <Moon /> Dark
        </MenuItem>
        <MenuItem onSelect={() => setTheme("system")}>
          <Laptop /> System
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", EMPLOYEE: "Employee" };

function UserMenu({ user, compact }: { user: ShellUser; compact?: boolean }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className={cn("flex items-center gap-3 rounded-lg text-left hover:bg-surface-2", compact ? "p-0.5" : "w-full p-2")}>
          <Avatar name={user.name} className="size-8" />
          {!compact ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block text-xs text-subtle">{ROLE_LABEL[user.role] ?? user.role}</span>
            </span>
          ) : null}
        </button>
      </MenuTrigger>
      <MenuContent align={compact ? "end" : "start"}>
        <MenuLabel>{user.email}</MenuLabel>
        <MenuItem onSelect={() => (window.location.href = "/account")}>
          <CircleUser /> My account
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={() => logoutAction()}>
          <LogOut /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

type Hit = { type: string; id: string; title: string; subtitle: string; href: string; amount?: number };

function CommandPalette({ open, onOpenChange, nav, quick, onQuick }: { open: boolean; onOpenChange: (o: boolean) => void; nav: typeof NAV; quick: typeof QUICK; onQuick: (k: QuickKind) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
    }
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { hits?: Hit[] };
        setHits(json.hits ?? []);
        setActive(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  const navMatches = q ? nav.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())) : [];
  const quickMatches = q ? quick.filter((x) => x.label.toLowerCase().includes(q.toLowerCase())) : quick;
  const items: { key: string; label: string; sub?: string; icon: React.ReactNode; run: () => void; amount?: number }[] = [
    ...hits.map((h) => ({ key: h.type + h.id, label: h.title, sub: `${h.type[0].toUpperCase() + h.type.slice(1)} · ${h.subtitle}`, icon: <Avatar name={h.title} className="size-7 text-[11px]" />, run: () => router.push(h.href), amount: h.amount })),
    ...quickMatches.map((x) => ({ key: "q" + x.kind, label: x.label, sub: "Quick action", icon: <x.icon className="size-4 text-subtle" />, run: () => onQuick(x.kind) })),
    ...navMatches.map((n) => ({ key: "n" + n.href, label: n.label, sub: "Go to", icon: <n.icon className="size-4 text-subtle" />, run: () => router.push(n.href) })),
  ];
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    onOpenChange(false);
    it.run();
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-[10vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop data-[state=open]:animate-up"
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search customers, suppliers, invoices, products and transactions</DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b border-border px-4">
            {loading ? <Loader2 className="size-4 animate-spin text-subtle" /> : <Search className="size-4 text-subtle" />}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, items.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(active);
                }
              }}
              placeholder="Name, mobile, invoice no., product, T-000123…"
              className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {items.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted">{q.trim().length >= 2 && !loading ? "No matches found." : "Type at least 2 characters to search."}</div>
            ) : (
              items.map((it, i) => (
                <button key={it.key} onMouseEnter={() => setActive(i)} onClick={() => choose(i)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", i === active ? "bg-surface-2" : "")}>
                  <span className="grid size-7 place-items-center">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.label}</span>
                    {it.sub ? <span className="block truncate text-xs text-muted">{it.sub}</span> : null}
                  </span>
                  {it.amount !== undefined ? <span className="tnum text-xs font-medium text-muted">{formatINR(it.amount)}</span> : <ChevronRight className="size-4 text-subtle" />}
                </button>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
