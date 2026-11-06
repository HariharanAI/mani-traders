import Link from "next/link";
import { ArrowRight, BarChart3, Boxes, Landmark, ShieldCheck, Users } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { REPORTS } from "@/server/services/reports";
import { PageHeader } from "@/components/page";
import { Card } from "@/components/ui";

export const metadata = { title: "Reports" };

const GROUP_ICON = { Sales: BarChart3, Parties: Users, Money: Landmark, Stock: Boxes, Accounts: ShieldCheck } as const;

export default async function ReportsPage() {
  await requirePage("reports.view");
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports" description="Calculated from your ledger. Revenue, collections, profit and cash flow are kept distinct." />
      <div className="space-y-6">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g as keyof typeof GROUP_ICON];
          return (
            <section key={g}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
                <Icon className="size-4" /> {g}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {REPORTS.filter((r) => r.group === g).map((r) => (
                  <Link key={r.key} href={`/reports/${r.key}`}>
                    <Card className="group flex h-full items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                      <div>
                        <div className="font-medium">{r.title}</div>
                        <div className="mt-0.5 text-sm text-muted">{r.desc}</div>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
