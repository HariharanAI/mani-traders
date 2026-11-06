import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, CalendarClock, HandCoins, IndianRupee, Landmark, PackageX, Receipt, ShoppingCart, TrendingUp, Truck, Users, Wallet } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { counterSummary, dashboard } from "@/server/services/reports";
import { recentLedger } from "@/server/services/khata";
import { PageHeader, StatCard } from "@/components/page";
import { RangeFilter } from "@/components/filters";
import { Avatar, Badge, Card, CardHeader, EmptyState, Money } from "@/components/ui";
import { DailySalesChart, MonthlyRevenueChart, CollectionsChart } from "@/components/charts";
import { DashboardQuick } from "./dashboard-quick";
import { resolveRange, formatDate, timeAgo } from "@/lib/dates";
import { formatINR, formatQty } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/accounts";

export const metadata = { title: "Dashboard" };

const TXN_LABEL: Record<string, string> = { OPENING_BALANCE: "Opening balance", CREDIT_GIVEN: "Credit", SALE: "Sale", PAYMENT_IN: "Payment in", PAYMENT_OUT: "Payment out", SALES_RETURN: "Return", PURCHASE: "Purchase", PURCHASE_RETURN: "Return", ADJUSTMENT: "Adjustment", REVERSAL: "Reversal" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage();
  const db = await getDb();
  const sp = await searchParams;
  const greeting = `Hello, ${actor.name.split(" ")[0]}`;

  if (!can(actor, "dashboard.financials")) {
    const mine = await counterSummary(db, actor);
    const recent = can(actor, "ledger.view") ? await recentLedger(db, actor, { limit: 10 }) : [];
    return (
      <>
        <PageHeader title={greeting} description="Your counter for today" />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="My sales today" value={mine.salesAmount} hint={`${mine.salesCount} invoices`} icon={ShoppingCart} tone="brand" />
          <StatCard label="Payments I received today" value={mine.paymentsAmount} hint={`${mine.paymentsCount} receipts`} icon={IndianRupee} tone="give" />
        </div>
        <DashboardQuick />
        {recent.length ? (
          <Card className="mt-5">
            <CardHeader title="Recent khata activity" />
            <RecentList rows={recent} />
          </Card>
        ) : null}
      </>
    );
  }

  const range = resolveRange(sp, "today");
  const d = await dashboard(db, actor, range);
  const m = d.metrics;
  const rangeWord = range.key === "today" ? "Today's" : range.label;

  return (
    <>
      <PageHeader title={greeting} description={`Business overview · ${range.label}${range.from !== range.to ? ` (${formatDate(range.from)} – ${formatDate(range.to)})` : ""}`} actions={<RangeFilter defaultRange="today" />} />

      {/* Position (as of now) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total receivables" value={m.receivables} tone="get" icon={ArrowDownLeft} hint={`${m.customersOwing} customers owe you`} href="/customers?status=owes" />
        <StatCard label="Total payables" value={m.payables} tone="give" icon={ArrowUpRight} hint="Owed to suppliers" href="/suppliers?status=owes" />
        <StatCard label="Overdue credit" value={m.overdue} tone="warn" icon={CalendarClock} hint={`No payment in ${d.creditPeriodDays}+ days`} href="/reports/customer-outstanding" />
        <StatCard label="Inventory value" value={m.inventoryValue} icon={Boxes} hint={m.lowStockCount ? `${m.lowStockCount} products low on stock` : "At average cost"} href="/inventory" />
      </div>
      {/* Activity (selected range) */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`${rangeWord} sales`} value={m.sales} tone="brand" icon={ShoppingCart} hint={`Billed ${formatINR(m.salesBilled, { decimals: false })} incl. GST`} href={`/sales?range=${range.key}`} />
        <StatCard label={`${rangeWord} collections`} value={m.collections} tone="give" icon={HandCoins} hint={`${m.collectionsCount} payments received`} href={`/payments?direction=IN&range=${range.key}`} />
        <StatCard label={`${rangeWord} expenses`} value={m.expenses} icon={Receipt} href={`/expenses?range=${range.key}`} />
        <StatCard label="Net cash flow" value={m.netCash} tone={m.netCash >= 0 ? "give" : "get"} icon={Landmark} hint="Change in cash, bank & UPI" href={`/reports/cash-flow?range=${range.key}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatCard label="Customers" value={m.customers} money={false} icon={Users} href="/customers" />
        <StatCard label="Suppliers" value={m.suppliers} money={false} icon={Truck} href="/suppliers" />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <DailySalesChart data={d.daily} />
        <MonthlyRevenueChart data={d.monthly} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CollectionsChart data={d.monthly} />
        </div>
        <Card>
          <CardHeader title="Business performance" description={range.label} />
          <dl className="grid grid-cols-2 gap-3 p-4 sm:p-5">
            {[
              ["Gross profit", formatINR(d.performance.grossProfit, { decimals: false })],
              ["Profit estimate", formatINR(d.performance.profitEstimate, { decimals: false })],
              ["Gross margin", d.performance.grossMargin === null ? "—" : `${d.performance.grossMargin}%`],
              ["Expense ratio", d.performance.expenseRatio === null ? "—" : `${d.performance.expenseRatio}%`],
              ["Invoices", String(d.performance.invoices)],
              ["Avg. invoice", formatINR(d.performance.avgInvoice, { decimals: false })],
              ["Collection rate (12m)", d.performance.collectionRate === null ? "—" : `${d.performance.collectionRate}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="tnum mt-1 text-base font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Overdue customers" description={`No payment for over ${d.creditPeriodDays} days`} action={<Link href="/reports/customer-outstanding" className="text-xs font-medium text-brand">View all</Link>} />
          {d.overdue.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {d.overdue.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                    <Avatar name={c.name} tone="get" className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">{c.daysSincePayment} days since {c.lastPayment ? "last payment" : "first credit"}</span>
                    </span>
                    <Money value={c.balance} tone="get" className="text-sm font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={AlertTriangle} title="No overdue balances" description="Customers with a balance and no recent payment appear here." className="py-8" />
          )}
        </Card>

        <Card>
          <CardHeader title="Top customers" description={`By billed sales · ${range.label}`} />
          {d.top.length ? (
            <ul className="space-y-1 px-2 py-2">
              {d.top.map((c, i) => {
                const pct = d.top[0].total ? Math.max(6, Math.round((c.total / d.top[0].total) * 100)) : 0;
                return (
                  <li key={c.id}>
                    <Link href={`/customers/${c.id}`} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">
                          <span className="mr-2 text-subtle">{i + 1}</span>
                          {c.name}
                        </span>
                        <span className="tnum font-medium">{formatINR(c.total, { decimals: false })}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">
                        <div className="h-1.5 rounded-full bg-[var(--chart-1)]" style={{ width: `${pct}%` }} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={TrendingUp} title="No sales in this period" description="Create a sale to see your top customers." className="py-8" />
          )}
        </Card>

        <Card>
          <CardHeader title="Low stock" description="At or below the alert level" action={<Link href="/inventory?stock=low" className="text-xs font-medium text-brand">View all</Link>} />
          {d.lowStock.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {d.lowStock.map((p) => (
                <li key={p.id}>
                  <Link href={`/inventory/${p.id}`} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                    <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                    <Badge tone={p.qtyMilli <= 0 ? "get" : "warn"}>
                      {formatQty(p.qtyMilli)} {p.unit}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={PackageX} title="Stock levels are healthy" description="Set a low-stock level on products to get alerts." className="py-8" />
          )}
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Recent payments" action={<Link href="/payments" className="text-xs font-medium text-brand">All payments</Link>} />
          {d.recentPayments.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {d.recentPayments.map((p) => (
                <li key={p.id}>
                  <Link href={`/payments/${p.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                    <span className={`grid size-8 place-items-center rounded-full ${p.direction === "IN" ? "bg-give-soft text-give" : "bg-get-soft text-get"}`}>{p.direction === "IN" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.partyName}</span>
                      <span className="block text-xs text-muted">
                        {formatDate(p.date)} · {PAYMENT_METHOD_LABEL[p.method]}
                      </span>
                    </span>
                    <Money value={p.amount} tone={p.direction === "IN" ? "give" : "get"} className="text-sm font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Wallet} title="No payments yet" className="py-8" />
          )}
        </Card>

        <Card>
          <CardHeader title="Recent purchases" action={<Link href="/purchases" className="text-xs font-medium text-brand">All purchases</Link>} />
          {d.recentPurchases.length ? (
            <ul className="divide-y divide-border px-1 py-2">
              {d.recentPurchases.map((p) => (
                <li key={p.id}>
                  <Link href={`/purchases/${p.id}`} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.supplier}</span>
                      <span className="block text-xs text-muted">
                        {p.purchaseNo} · {formatDate(p.date)}
                      </span>
                    </span>
                    <span className="tnum text-sm font-semibold">{formatINR(p.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ShoppingCart} title="No purchases yet" className="py-8" />
          )}
        </Card>

        <Card>
          <CardHeader title="Recent transactions" action={<Link href="/khata" className="text-xs font-medium text-brand">Khata</Link>} />
          {d.recent.length ? <RecentList rows={d.recent} /> : <EmptyState title="No transactions yet" className="py-8" />}
        </Card>
      </div>
    </>
  );
}

function RecentList({ rows }: { rows: Awaited<ReturnType<typeof recentLedger>> }) {
  return (
    <ul className="divide-y divide-border px-1 py-2">
      {rows.map((t) => {
        const isCust = t.partyType === "CUSTOMER";
        const owesMore = isCust ? t.effectP > 0 : t.effectP < 0;
        return (
          <li key={t.id}>
            <Link href={`/${isCust ? "customers" : "suppliers"}/${t.partyId}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.partyName}</span>
                <span className="block truncate text-xs text-muted">
                  {TXN_LABEL[t.type]} · {timeAgo(t.createdAt)}
                  {t.status !== "ACTIVE" ? ` · ${t.status.toLowerCase()}` : ""}
                </span>
              </span>
              <Money value={t.amountP} tone={owesMore ? "get" : "give"} className={`text-sm font-semibold ${t.status === "REVERSED" ? "line-through opacity-60" : ""}`} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
