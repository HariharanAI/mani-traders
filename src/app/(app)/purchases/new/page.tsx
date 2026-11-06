import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getSettingsRow } from "@/server/core";
import { productOptions } from "@/server/services/inventory";
import { getSupplier, partySummary } from "@/server/services/parties";
import { salesTaxMode } from "@/server/services/sales";
import { PageHeader } from "@/components/page";
import { BillEditor } from "@/components/bill-editor";
import { Card, EmptyState, Button } from "@/components/ui";
import Link from "next/link";
import { Package } from "lucide-react";

export const metadata = { title: "New purchase" };

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const actor = await requirePage("purchases.create");
  const { supplier } = await searchParams;
  const db = await getDb();
  const [settings, products] = await Promise.all([getSettingsRow(db), productOptions(db)]);
  let preset = null;
  if (supplier) {
    try {
      const s = await getSupplier(db, actor, supplier);
      const sum = await partySummary(db, { type: "SUPPLIER", id: s.id });
      preset = { id: s.id, name: s.name, mobile: s.mobile, balance: sum.balance, code: s.code, stateCode: s.stateCode };
    } catch {
      preset = null;
    }
  }
  return (
    <>
      <PageHeader back={{ href: "/purchases", label: "Purchases" }} title="New purchase" description="Stock and the supplier's balance update when you save." />
      {products.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title="Add products first" description="Purchases add stock to products. Create your products, then record the purchase." action={<Link href="/inventory"><Button>Go to inventory</Button></Link>} />
        </Card>
      ) : (
        <BillEditor mode="purchase" products={products} taxMode={salesTaxMode(settings)} businessState={settings.stateCode} presetParty={preset} />
      )}
    </>
  );
}
