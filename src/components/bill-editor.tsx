"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Barcode, Check, PackagePlus, Plus, Trash2, UserRound, Users } from "lucide-react";
import { Button, Card, Field, Input, MoneyInput, Money, Segmented, Select, Textarea } from "./ui";
import { CustomerDialog, MethodPicker, PartyPicker, SupplierDialog, FileAttach } from "./forms";
import { useAction, useIdempotencyKey } from "./hooks";
import { createPurchaseAction, createSaleAction } from "@/app/_actions/business";
import { computeBill, GST_RATES, type TaxMode } from "@/lib/gst";
import { formatINR, formatQty, toMilli, toPaise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/accounts";
import { cn } from "@/lib/utils";

export type ProductOption = { id: string; name: string; code: string; sku: string | null; barcode: string | null; hsnCode: string | null; unit: string; sellingPrice: string; purchasePrice: string; gstRate: string; stockQty: string };
type Party = { id: string; name: string; mobile: string | null; balance: number; code: string; stateCode?: string | null };
type Line = { key: string; productId: string | null; description: string; quantity: string; rate: string; discount: string; gstRate: string; unit: string; hsnCode: string | null };

const newLine = (): Line => ({ key: crypto.randomUUID(), productId: null, description: "", quantity: "1", rate: "", discount: "", gstRate: "0", unit: "pcs", hsnCode: null });
const valid = (v: string, re = /^\d+(\.\d{1,2})?$/) => re.test(v);

function ProductSearch({ products, onPick, autoFocus }: { products: ProductOption[]; onPick: (p: ProductOption) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products.slice(0, 8);
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.barcode === q.trim() || p.code.toLowerCase() === s).slice(0, 10);
  }, [q, products]);
  const pick = (p: ProductOption) => {
    onPick(p);
    setQ("");
    setActive(0);
  };
  return (
    <div className="relative">
      <Barcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, matches.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter") {
            e.preventDefault();
            // exact barcode scan wins
            const exact = products.find((p) => p.barcode && p.barcode === q.trim());
            if (exact) pick(exact);
            else if (matches[active]) pick(matches[active]);
          }
        }}
        placeholder="Search product by name, SKU or scan barcode"
        className="pl-9"
      />
      {open && matches.length ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop">
          {matches.map((p, i) => {
            const stock = toMilli(p.stockQty);
            return (
              <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left", i === active ? "bg-surface-2" : "hover:bg-surface-2")}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {p.sku ?? p.code} · <span className={stock <= 0 ? "text-get" : ""}>{formatQty(stock)} {p.unit} in stock</span>
                  </span>
                </span>
                <span className="tnum text-sm text-muted">{formatINR(toPaise(p.sellingPrice))}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function BillEditor({
  mode,
  products,
  taxMode: saleTaxMode,
  businessState,
  presetParty,
  canNegative,
  allowNegativeSetting,
}: {
  mode: "sale" | "purchase";
  products: ProductOption[];
  taxMode: TaxMode;
  businessState: string | null;
  presetParty?: Party | null;
  canNegative?: boolean;
  allowNegativeSetting?: boolean;
}) {
  const router = useRouter();
  const isSale = mode === "sale";
  const [walkIn, setWalkIn] = useState(isSale && !presetParty);
  const [party, setParty] = useState<Party | null>(presetParty ?? null);
  const [walkInName, setWalkInName] = useState("");
  const [walkInMobile, setWalkInMobile] = useState("");
  const [date, setDate] = useState(todayIST());
  const [lines, setLines] = useState<Line[]>([]);
  const [purchaseTaxMode, setPurchaseTaxMode] = useState<TaxMode>(saleTaxMode === "NONE" ? "NONE" : "EXCLUSIVE");
  const [paid, setPaid] = useState("");
  const [paidTouched, setPaidTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [supplierBill, setSupplierBill] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [allowNeg, setAllowNeg] = useState(false);
  const [newParty, setNewParty] = useState<string | null>(null);
  const idem = useIdempotencyKey();
  const saleAction = useAction(createSaleAction);
  const purchaseAction = useAction(createPurchaseAction);
  const pending = saleAction.pending || purchaseAction.pending;
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const taxMode = isSale ? saleTaxMode : purchaseTaxMode;
  const interstate = taxMode !== "NONE" && !!(party?.stateCode && businessState && party.stateCode !== businessState);

  const bill = useMemo(() => {
    const ok = lines.filter((l) => l.description && valid(l.quantity, /^\d+(\.\d{1,3})?$/) && toMilli(l.quantity) > 0 && valid(l.rate || "0") && valid(l.discount || "0"));
    try {
      return { result: computeBill(ok.map((l) => ({ quantity: l.quantity, rate: l.rate || "0", discount: l.discount || "0", gstRate: l.gstRate })), taxMode, interstate, true), error: null as string | null, count: ok.length };
    } catch (e) {
      return { result: null, error: (e as Error).message, count: ok.length };
    }
  }, [lines, taxMode, interstate]);
  const total = bill.result?.grandTotal ?? 0;
  const paidP = paidTouched ? (valid(paid || "0") ? toPaise(paid || "0") : 0) : walkIn ? total : 0;
  const due = Math.max(total - paidP, 0);

  const stockWarnings = isSale
    ? lines.filter((l) => {
        const p = l.productId ? productMap.get(l.productId) : null;
        return p && valid(l.quantity, /^\d+(\.\d{1,3})?$/) && toMilli(l.quantity) > toMilli(p.stockQty);
      })
    : [];

  const addProduct = (p: ProductOption) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) {
        return ls.map((l) => (l.key === existing.key ? { ...l, quantity: formatQty(toMilli(l.quantity || "0") + 1000) } : l));
      }
      const price = isSale ? p.sellingPrice : p.purchasePrice;
      const line: Line = { key: crypto.randomUUID(), productId: p.id, description: p.name, quantity: "1", rate: toPaise(price) ? String(toPaise(price) / 100) : "", discount: "", gstRate: String(Number(p.gstRate)), unit: p.unit, hsnCode: p.hsnCode };
      setTimeout(() => qtyRefs.current[line.key]?.select(), 30);
      return [...ls, line];
    });
  };
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!bill.count) return toast.error("Add at least one item");
    if (!isSale && !party) return toast.error("Select a supplier");
    if (isSale && !walkIn && !party) return toast.error("Select a customer, or switch to walk-in");
    if (bill.error) return toast.error(bill.error);
    const payloadLines = lines
      .filter((l) => l.description)
      .map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, rate: l.rate || "0", discount: l.discount || "0", gstRate: l.gstRate, unit: l.unit, hsnCode: l.hsnCode }));
    const amt = (paidP / 100).toFixed(2);
    if (isSale) {
      const res = await saleAction.run({ customerId: walkIn ? null : party!.id, walkInName: walkIn ? walkInName || null : null, walkInMobile: walkIn ? walkInMobile || null : null, date, lines: payloadLines, amountReceived: amt, paymentMethod: method, paymentReference: reference || null, notes: notes || null, allowNegativeStock: allowNeg, idempotencyKey: idem.key });
      if (res.ok) {
        toast.success(`Invoice ${res.data!.invoiceNo} saved`);
        router.push(`/sales/${res.data!.id}?created=1`);
      }
    } else {
      const res = await purchaseAction.run({ supplierId: party!.id, supplierInvoiceNo: supplierBill || null, date, taxMode: purchaseTaxMode, lines: payloadLines.map((l) => ({ ...l, productId: l.productId! })), amountPaid: amt, paymentMethod: method, paymentReference: reference || null, notes: notes || null, attachmentKey: attachment, idempotencyKey: idem.key });
      if (res.ok) {
        toast.success(`Purchase ${res.data!.purchaseNo} saved`);
        router.push(`/purchases/${res.data!.id}`);
      }
    }
  };

  return (
    <div className="grid gap-4 pb-28 lg:grid-cols-[1fr_360px] lg:pb-0">
      <div className="space-y-4">
        <Card className="space-y-4 p-4 sm:p-5">
          {isSale ? (
            <Segmented
              value={walkIn ? "walkin" : "customer"}
              onChange={(v) => {
                setWalkIn(v === "walkin");
                setPaidTouched(false);
              }}
              options={[
                { value: "customer", label: <span className="inline-flex items-center gap-1.5"><Users className="size-4" /> Customer (khata)</span> },
                { value: "walkin", label: <span className="inline-flex items-center gap-1.5"><UserRound className="size-4" /> Walk-in cash sale</span> },
              ]}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            {isSale && walkIn ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Customer name (optional)">
                  <Input value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Walk-in customer" />
                </Field>
                <Field label="Mobile (optional)">
                  <Input value={walkInMobile} onChange={(e) => setWalkInMobile(e.target.value)} inputMode="tel" />
                </Field>
              </div>
            ) : (
              <Field label={isSale ? "Customer" : "Supplier"} required>
                <PartyPicker type={isSale ? "CUSTOMER" : "SUPPLIER"} value={party} onChange={setParty} onCreateNew={(n) => setNewParty(n)} />
              </Field>
            )}
            <Field label={isSale ? "Invoice date" : "Bill date"}>
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {!isSale ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier bill / invoice no.">
                <Input value={supplierBill} onChange={(e) => setSupplierBill(e.target.value)} />
              </Field>
              <Field label="Prices on supplier bill">
                <Select value={purchaseTaxMode} onChange={(e) => setPurchaseTaxMode(e.target.value as TaxMode)}>
                  <option value="EXCLUSIVE">GST extra (exclusive)</option>
                  <option value="INCLUSIVE">GST included (inclusive)</option>
                  <option value="NONE">No GST on bill</option>
                </Select>
              </Field>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="border-b border-border p-3">
            <ProductSearch products={products} onPick={addProduct} autoFocus={!!presetParty || (isSale && walkIn)} />
          </div>
          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <PackagePlus className="size-8 text-subtle" />
              <p className="text-sm text-muted">Search a product above{isSale ? ", or add a custom item" : ""}.</p>
              {isSale ? (
                <Button variant="secondary" size="sm" onClick={() => setLines((l) => [...l, newLine()])}>
                  <Plus /> Custom item
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {lines.map((l, idx) => {
                const r = bill.result?.lines[idx];
                const p = l.productId ? productMap.get(l.productId) : null;
                const short = stockWarnings.includes(l);
                return (
                  <div key={l.key} className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-[1fr_90px_110px_90px_80px_110px_36px] sm:items-end">
                    <Field label={idx === 0 ? "Item" : undefined} className="col-span-2 sm:col-span-1">
                      {p ? (
                        <div className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm">
                          <span className="truncate font-medium">{l.description}</span>
                        </div>
                      ) : (
                        <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="Item description" />
                      )}
                      {p ? (
                        <p className={cn("text-[11px]", short ? "text-get" : "text-subtle")}>
                          {short ? <AlertTriangle className="mr-0.5 inline size-3" /> : null}
                          Stock {formatQty(toMilli(p.stockQty))} {p.unit}
                        </p>
                      ) : null}
                    </Field>
                    <Field label={idx === 0 ? `Qty${l.unit ? ` (${l.unit})` : ""}` : undefined}>
                      <Input ref={(el) => { qtyRefs.current[l.key] = el; }} value={l.quantity} inputMode="decimal" onChange={(e) => /^\d*(\.\d{0,3})?$/.test(e.target.value) && update(l.key, { quantity: e.target.value })} className="tnum" />
                    </Field>
                    <Field label={idx === 0 ? "Rate" : undefined}>
                      <MoneyInput value={l.rate} onChange={(v) => update(l.key, { rate: v })} />
                    </Field>
                    <Field label={idx === 0 ? "Discount" : undefined}>
                      <MoneyInput value={l.discount} onChange={(v) => update(l.key, { discount: v })} />
                    </Field>
                    <Field label={idx === 0 ? "GST %" : undefined}>
                      <Select value={l.gstRate} onChange={(e) => update(l.key, { gstRate: e.target.value })} disabled={taxMode === "NONE"}>
                        {GST_RATES.map((g) => (
                          <option key={g} value={g}>
                            {g}%
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex h-10 items-center justify-end text-sm font-semibold sm:col-auto">
                      <span className="mr-auto text-xs font-normal text-muted sm:hidden">Amount</span>
                      <span className="tnum">{r ? formatINR(r.total) : "—"}</span>
                    </div>
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-lg text-xs text-subtle hover:bg-get-soft hover:text-get sm:col-span-1 sm:size-9" aria-label="Remove item">
                      <Trash2 className="size-4" />
                      <span className="sm:hidden">Remove</span>
                    </button>
                  </div>
                );
              })}
              {isSale ? (
                <div className="p-3">
                  <Button variant="ghost" size="sm" onClick={() => setLines((l) => [...l, newLine()])}>
                    <Plus /> Custom item
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          {bill.error ? <p className="border-t border-border px-4 py-2 text-xs text-get">{bill.error}</p> : null}
        </Card>

        <Card className="space-y-4 p-4 sm:p-5">
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={isSale ? "Printed on the invoice" : ""} />
          </Field>
          {!isSale ? <FileAttach value={attachment} onChange={setAttachment} folder="bills" label="Attach supplier bill" /> : null}
        </Card>
      </div>

      {/* Summary */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
        <Card className="p-4 sm:p-5">
          <h3 className="mb-3 text-[15px] font-semibold">{isSale ? (taxMode === "NONE" ? "Bill of supply" : "Tax invoice") : "Purchase bill"}</h3>
          <dl className="space-y-1.5 text-sm">
            <Row k="Subtotal" v={bill.result?.subtotal ?? 0} />
            {bill.result?.discountTotal ? <Row k="Discount" v={-bill.result.discountTotal} /> : null}
            {taxMode !== "NONE" ? (
              <>
                <Row k="Taxable value" v={bill.result?.taxableTotal ?? 0} />
                {interstate ? <Row k="IGST" v={bill.result?.igstTotal ?? 0} /> : (
                  <>
                    <Row k="CGST" v={bill.result?.cgstTotal ?? 0} />
                    <Row k="SGST" v={bill.result?.sgstTotal ?? 0} />
                  </>
                )}
              </>
            ) : null}
            {bill.result?.roundOff ? <Row k="Round off" v={bill.result.roundOff} /> : null}
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tnum">{formatINR(total)}</dd>
            </div>
          </dl>
          {taxMode === "NONE" && isSale ? <p className="mt-2 text-xs text-subtle">GST is not charged (business not GST-registered or on composition scheme — see Settings).</p> : null}
        </Card>
        <Card className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">{isSale ? "Payment received" : "Payment made"}</h3>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={() => (setPaidTouched(true), setPaid((total / 100).toFixed(2)))}>
                Full
              </Button>
              {!walkIn ? (
                <Button variant="secondary" size="sm" onClick={() => (setPaidTouched(true), setPaid(""))}>
                  Credit
                </Button>
              ) : null}
            </div>
          </div>
          <MoneyInput value={paidTouched ? paid : walkIn ? (total / 100).toFixed(2) : ""} onChange={(v) => (setPaidTouched(true), setPaid(v))} disabled={walkIn} />
          {paidP > 0 ? <MethodPicker value={method} onChange={setMethod} /> : null}
          {paidP > 0 && method !== "CASH" ? <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "UPI" ? "UPI transaction ID" : method === "CHEQUE" ? "Cheque number" : "Reference"} /> : null}
          <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">{isSale ? "Balance added to khata" : "Payable added"}</span>
            <Money value={due} tone={due > 0 ? (isSale ? "get" : "give") : "none"} className="font-semibold" />
          </div>
          {paidP > total && total > 0 ? <p className="text-xs text-get">Amount is more than the total. Record any extra as a separate payment.</p> : null}
          {walkIn ? <p className="text-xs text-subtle">Walk-in sales are fully paid. Select a customer to sell on credit.</p> : null}
          {stockWarnings.length ? (
            <div className="rounded-lg border border-get/30 bg-get-soft p-3 text-xs text-get">
              <AlertTriangle className="mr-1 inline size-3.5" />
              {stockWarnings.length} item(s) exceed available stock.
              {allowNegativeSetting ? " Negative stock is allowed in Settings." : canNegative ? (
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={allowNeg} onChange={(e) => setAllowNeg(e.target.checked)} /> Sell anyway (authorised)
                </label>
              ) : " Reduce quantity or record a purchase first."}
            </div>
          ) : null}
        </Card>
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
          <Button size="lg" className="w-full" onClick={submit} loading={pending} disabled={!bill.count || paidP > total}>
            <Check /> Save {isSale ? "invoice" : "purchase"} · {formatINR(total)}
          </Button>
        </div>
      </div>
      {isSale ? (
        <CustomerDialog open={newParty !== null} onOpenChange={(o) => !o && setNewParty(null)} initialName={newParty ?? ""} onSaved={(c) => (setParty({ ...c, balance: 0, code: "" }), setNewParty(null))} />
      ) : (
        <SupplierDialog open={newParty !== null} onOpenChange={(o) => !o && setNewParty(null)} initialName={newParty ?? ""} onSaved={(s) => (setParty({ ...s, mobile: null, balance: 0, code: "" }), setNewParty(null))} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="tnum">{formatINR(v)}</dd>
    </div>
  );
}
