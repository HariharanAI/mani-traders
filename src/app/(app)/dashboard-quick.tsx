"use client";
import { IndianRupee, Package, Receipt, ShoppingBag, ShoppingCart, UserPlus } from "lucide-react";
import { useShell } from "@/components/shell";
import type { Permission } from "@/lib/permissions";

const ITEMS = [
  { k: "sale", label: "Add sale", icon: ShoppingCart, perm: "sales.create" },
  { k: "payment", label: "Receive payment", icon: IndianRupee, perm: "payments.receive" },
  { k: "customer", label: "Add customer", icon: UserPlus, perm: "customers.manage" },
  { k: "expense", label: "Add expense", icon: Receipt, perm: "expenses.manage" },
  { k: "purchase", label: "Add purchase", icon: ShoppingBag, perm: "purchases.create" },
  { k: "product", label: "Add product", icon: Package, perm: "inventory.manage" },
] as const;

export function DashboardQuick() {
  const { can, quick } = useShell();
  const items = ITEMS.filter((i) => can(i.perm as Permission));
  if (!items.length) return null;
  return (
    <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map((i) => (
        <button key={i.k} onClick={() => quick(i.k)} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-3 text-xs font-medium shadow-card transition-colors hover:border-border-strong active:scale-[0.98]">
          <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
            <i.icon className="size-5" />
          </span>
          {i.label}
        </button>
      ))}
    </div>
  );
}
