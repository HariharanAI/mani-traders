import { BookOpenText, ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-brand text-brand-fg shadow-card">
              <BookOpenText className="size-5" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">MANI TRADERS</div>
              <div className="text-xs text-subtle">Business ledger & billing</div>
            </div>
          </div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l border-border bg-surface-2 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--brand-soft),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <div className="max-w-md space-y-6">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight">Every rupee, accounted for.</h2>
            <p className="text-muted">Khata, invoices, stock and payments in one place, on a double-entry ledger where no entry is ever silently overwritten or deleted.</p>
            <div className="space-y-3">
              {[
                ["Customer khata", "Running balances, statements, WhatsApp reminders"],
                ["GST-ready billing", "Tax invoices or bill of supply, PDF & print"],
                ["Stock & purchases", "Average-cost inventory with low-stock alerts"],
              ].map(([t, d]) => (
                <div key={t} className="flex gap-3 rounded-xl border border-border bg-surface/80 p-4 shadow-card">
                  <ShieldCheck className="mt-0.5 size-5 text-brand" />
                  <div>
                    <div className="text-sm font-semibold">{t}</div>
                    <div className="text-sm text-muted">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
