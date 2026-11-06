"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Download, MoreHorizontal, Printer, Undo2, Wallet } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, MoneyInput, Menu, MenuContent, MenuItem, MenuTrigger, Switch, Textarea } from "@/components/ui";
import { MethodPicker, PaymentDialog, ReasonDialog } from "@/components/forms";
import { WhatsAppButton } from "@/components/whatsapp";
import { useShell } from "@/components/shell";
import { useAction, useIdempotencyKey } from "@/components/hooks";
import { cancelSaleAction, saleReturnAction } from "@/app/_actions/business";
import { formatQty, formatINR, proportion, toMilli } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import type { PaymentMethod } from "@/lib/accounts";

type SaleLite = { id: string; invoiceNo: string; status: string; customerId: string | null; customerName: string; customerMobile: string | null; due: number; balance: number; hasReturns: boolean; paidCount: number };
type Item = { id: string; description: string; unit: string; sold: number; returned: number; total: number };

export function SaleActions({ sale, items }: { sale: SaleLite; items: Item[] }) {
  const { can } = useShell();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "cancel" | "return" | "pay">(null);
  const [reversePayments, setReversePayments] = useState(true);
  const active = sale.status === "ACTIVE";
  const printPdf = () => {
    const w = window.open(`/api/pdf/invoice/${sale.id}`, "_blank");
    w?.addEventListener("load", () => w.print());
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {active && sale.customerId && sale.due > 0 && can("payments.receive") ? (
          <Button variant="give" onClick={() => setDialog("pay")}>
            <Wallet /> Receive payment
          </Button>
        ) : null}
        <WhatsAppButton target={{ kind: "invoice", saleId: sale.id }} />
        <a href={`/api/pdf/invoice/${sale.id}?download=1`}>
          <Button variant="secondary">
            <Download /> PDF
          </Button>
        </a>
        <Button variant="secondary" onClick={printPdf}>
          <Printer /> Print
        </Button>
        {active && (can("sales.return") || can("sales.cancel")) ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="More">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {can("sales.return") ? (
                <MenuItem onSelect={() => setDialog("return")}>
                  <Undo2 /> Record return (credit note)
                </MenuItem>
              ) : null}
              {can("sales.cancel") && !sale.hasReturns ? (
                <MenuItem danger onSelect={() => setDialog("cancel")}>
                  <Ban /> Cancel invoice
                </MenuItem>
              ) : null}
            </MenuContent>
          </Menu>
        ) : null}
      </div>
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel invoice ${sale.invoiceNo}?`}
        description="Stock is returned and the ledger is reversed. The invoice stays on record marked as cancelled; the number is not reused."
        confirmLabel="Cancel invoice"
        extra={
          sale.customerId && sale.paidCount > 0 ? (
            <Switch checked={reversePayments} onChange={setReversePayments} label="Also reverse payments on this invoice" description="Turn off to keep the money as an advance in the customer's khata." />
          ) : null
        }
        onConfirm={async (reason) => {
          const r = await cancelSaleAction({ id: sale.id, reason, reversePayments: sale.customerId ? reversePayments : true });
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success("Invoice cancelled");
          router.refresh();
          return true;
        }}
      />
      {dialog === "return" ? <ReturnDialog sale={sale} items={items} onClose={() => setDialog(null)} /> : null}
      {sale.customerId ? (
        <PaymentDialog open={dialog === "pay"} onOpenChange={(o) => !o && setDialog(null)} direction="IN" party={{ type: "CUSTOMER", option: { id: sale.customerId, name: sale.customerName, mobile: sale.customerMobile, balance: sale.due, code: "" } }} />
      ) : null}
    </>
  );
}

function ReturnDialog({ sale, items, onClose }: { sale: SaleLite; items: Item[]; onClose: () => void }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refund, setRefund] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIST());
  const idem = useIdempotencyKey();
  const action = useAction(saleReturnAction);
  const est = items.reduce((a, i) => {
    const v = qty[i.id] || "";
    if (!/^\d+(\.\d{1,3})?$/.test(v)) return a;
    const q = toMilli(v);
    return q > 0 ? a + proportion(i.total, Math.min(q, i.sold - i.returned), i.sold) : a;
  }, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record sales return" description={`Credit note against ${sale.invoiceNo}. Returned items go back to stock.`}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await action.run({ saleId: sale.id, date, items: items.map((i) => ({ saleItemId: i.id, quantity: qty[i.id] || "0" })), refundAmount: sale.customerId ? refund || "0" : "0", refundMethod: method, reason, idempotencyKey: idem.key });
            if (res.ok) {
              toast.success(`Credit note ${(res.data as { returnNo?: string })?.returnNo ?? ""} saved`);
              onClose();
              router.refresh();
            }
          }}
        >
          <div className="space-y-2">
            {items.map((i) => {
              const left = i.sold - i.returned;
              return (
                <div key={i.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.description}</div>
                    <div className="text-xs text-muted">
                      Sold {formatQty(i.sold)} {i.unit} · can return {formatQty(left)}
                    </div>
                  </div>
                  <Input className="w-24" inputMode="decimal" placeholder="0" disabled={left <= 0} value={qty[i.id] ?? ""} onChange={(e) => /^\d*(\.\d{0,3})?$/.test(e.target.value) && setQty((q) => ({ ...q, [i.id]: e.target.value }))} />
                </div>
              );
            })}
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            Return value ≈ <b className="tnum">{formatINR(est)}</b> {sale.customerId ? "— credited to the customer's khata" : "— refunded in cash"}
          </div>
          {sale.customerId ? (
            <Field label="Refund now (optional)" hint="Leave empty to keep it as credit in the khata.">
              <MoneyInput value={refund} onChange={setRefund} />
            </Field>
          ) : null}
          {(sale.customerId ? !!refund : true) ? <MethodPicker value={method} onChange={setMethod} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Damaged, wrong item, excess…" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={action.pending} disabled={!est || reason.trim().length < 3}>
              Save return
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
