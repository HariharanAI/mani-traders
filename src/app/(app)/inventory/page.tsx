import Link from "next/link";
import { Boxes, Package } from "lucide-react";
import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can } from "@/server/core";
import { inventorySummary, listCategories, listProducts } from "@/server/services/inventory";
import { PageHeader, StatCard } from "@/components/page";
import { Pagination, SearchBox, SelectFilter } from "@/components/filters";
import { Badge, Card, EmptyState, Money, Table } from "@/components/ui";
import { AddProductButton } from "./client";
import { formatQty, toPaise } from "@/lib/money";

export const metadata = { title: "Inventory" };
const PAGE = 50;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePage("inventory.view");
  const sp = await searchParams;
  const db = await getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, sum, cats] = await Promise.all([
    listProducts(db, actor, { q: sp.q, categoryId: sp.category, stock: (sp.stock as never) ?? "all", archived: sp.view === "archived", sort: (sp.sort as never) ?? "name", limit: PAGE, offset: (page - 1) * PAGE }),
    inventorySummary(db),
    listCategories(db),
  ]);
  const showCost = can(actor, "inventory.manage") || can(actor, "reports.view");
  return (
    <>
      <PageHeader title="Inventory" description="Products, stock levels and valuation" actions={<AddProductButton />} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {showCost ? <StatCard label="Stock value (cost)" value={sum.value} tone="brand" hint="Moving-average cost" /> : null}
        {showCost ? <StatCard label="Stock value (selling price)" value={sum.retail} /> : null}
        <StatCard label="Low stock" value={sum.low} money={false} tone="warn" href="/inventory?stock=low" />
        <StatCard label="Out of stock" value={sum.out} money={false} tone="get" href="/inventory?stock=out" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchBox placeholder="Name, SKU, barcode" className="sm:max-w-xs sm:flex-1" />
          <SelectFilter param="category" options={[{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
          <SelectFilter param="stock" options={[{ value: "", label: "All stock" }, { value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }]} />
          <SelectFilter param="sort" options={[{ value: "", label: "Name" }, { value: "stock", label: "Lowest stock" }, { value: "value", label: "Highest value" }]} />
          <SelectFilter param="view" options={[{ value: "", label: "Active" }, { value: "archived", label: "Archived" }]} />
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={Boxes} title={sp.q || sp.stock ? "No products match" : "No products yet"} description="Add products to bill them quickly and track stock automatically." action={!sp.q ? <AddProductButton /> : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="!text-right">Stock</th>
                  <th className="hidden !text-right sm:table-cell">Selling price</th>
                  {showCost ? <th className="hidden !text-right md:table-cell">Avg cost</th> : null}
                  {showCost ? <th className="hidden !text-right lg:table-cell">Value</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td>
                      <Link href={`/inventory/${p.id}`} className="flex items-center gap-3">
                        {p.imageKey ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/files/${p.imageKey}`} alt="" className="size-9 rounded-lg border border-border object-cover" />
                        ) : (
                          <span className="grid size-9 place-items-center rounded-lg bg-surface-3 text-subtle">
                            <Package className="size-4" />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium hover:underline">{p.name}</span>
                          <span className="block text-xs text-muted">
                            {p.sku ?? p.code}
                            {p.category ? ` · ${p.category}` : ""} · GST {Number(p.gstRate)}%
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-right">
                      <span className="tnum font-semibold">{formatQty(p.qtyMilli)}</span> <span className="text-xs text-muted">{p.unit}</span>
                      <div>{p.qtyMilli <= 0 ? <Badge tone="get">Out</Badge> : p.isLow ? <Badge tone="warn">Low</Badge> : null}</div>
                    </td>
                    <td className="hidden text-right sm:table-cell">
                      <Money value={toPaise(p.sellingPrice)} />
                    </td>
                    {showCost ? (
                      <td className="hidden text-right text-muted md:table-cell">
                        <Money value={toPaise(p.avgCost)} />
                      </td>
                    ) : null}
                    {showCost ? (
                      <td className="hidden text-right lg:table-cell">
                        <Money value={p.valueP} className="font-medium" />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={list.total} pageSize={PAGE} page={page} />
          </>
        )}
      </Card>
    </>
  );
}
