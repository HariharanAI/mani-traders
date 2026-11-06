import { requirePage } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { can, getSettingsRow } from "@/server/core";
import { productOptions } from "@/server/services/inventory";
import { getCustomerForActor, partySummary } from "@/server/services/parties";
import { salesTaxMode } from "@/server/services/sales";
import { PageHeader } from "@/components/page";
import { BillEditor } from "@/components/bill-editor";

export const metadata = { title: "New sale" };

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requirePage("sales.create");
  const { customer } = await searchParams;
  const db = await getDb();
  const [settings, products] = await Promise.all([getSettingsRow(db), productOptions(db)]);
  let preset = null;
  if (customer) {
    try {
      const c = await getCustomerForActor(db, actor, customer);
      const sum = await partySummary(db, { type: "CUSTOMER", id: c.id });
      preset = { id: c.id, name: c.name, mobile: c.mobile, balance: sum.balance, code: c.code, stateCode: c.stateCode };
    } catch {
      preset = null;
    }
  }
  return (
    <>
      <PageHeader back={{ href: "/sales", label: "Sales" }} title="New sale" description="Totals, GST and stock are verified on the server when you save." />
      <BillEditor mode="sale" products={products} taxMode={salesTaxMode(settings)} businessState={settings.stateCode} presetParty={preset} canNegative={can(actor, "inventory.negative")} allowNegativeSetting={settings.allowNegativeStock} />
    </>
  );
}
