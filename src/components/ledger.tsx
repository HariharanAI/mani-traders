"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, BookOpenText, FileText, Paperclip, RotateCcw, Undo2 } from "lucide-react";
import { Badge, EmptyState, Money, Menu, MenuContent, MenuItem, MenuTrigger, Button } from "./ui";
import { ReasonDialog } from "./forms";
import { useShell } from "./shell";
import { reverseKhataEntryAction } from "@/app/_actions/business";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { cn } from "@/lib/utils";

export type LedgerRow = {
  id: string;
  txnNo: string;
  txnDate: string;
  type: string;
  description: string;
  amountP: number;
  effectP: number;
  running: number;
  paymentMethod: string | null;
  referenceNo: string | null;
  notes: string | null;
  attachmentKey: string | null;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  createdByName: string | null;
  createdAt: string;
  reversalReason: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  OPENING_BALANCE: "Opening balance",
  CREDIT_GIVEN: "Credit",
  SALE: "Sale",
  PAYMENT_IN: "Payment in",
  PAYMENT_OUT: "Payment out",
  SALES_RETURN: "Return",
  PURCHASE: "Purchase",
  PURCHASE_RETURN: "Return",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

/**
 * Statement with running balance. Column semantics follow the business view:
 * Customer: "You gave" (increases what they owe) / "You got" (reduces it).
 * Supplier: "You got" (bills, increases payable) / "You gave" (payments).
 */
export function LedgerTable({ rows, partyType, opening, partyPath }: { rows: LedgerRow[]; partyType: "CUSTOMER" | "SUPPLIER"; opening: number; partyPath: string }) {
  const { can } = useShell();
  const router = useRouter();
  const sp = useSearchParams();
  const highlight = sp.get("txn");
  const [hideReversed, setHideReversed] = useState(false);
  const [reverseRow, setReverseRow] = useState<LedgerRow | null>(null);
  const isCust = partyType === "CUSTOMER";
  const visible = hideReversed ? rows.filter((r) => r.status === "ACTIVE") : rows;
  const incLabel = isCust ? "You gave" : "You got";
  const decLabel = isCust ? "You got" : "You gave";
  if (!rows.length && opening === 0)
    return <EmptyState icon={BookOpenText} title="No entries yet" description={isCust ? "Use “You gave” when the customer takes goods on credit, and “You got” when they pay." : "Record purchases and payments to this supplier."} />;
  const canReverse = (r: LedgerRow) => r.status === "ACTIVE" && r.type !== "SALE" && r.type !== "PURCHASE" && r.sourceType !== "SALE_RETURN" && (r.sourceType === "PAYMENT" ? can("payments.reverse") : can("ledger.reverse"));
  const sourceLink = (r: LedgerRow) => (r.sourceType === "SALE" ? `/sales/${r.sourceId}` : r.sourceType === "PURCHASE" ? `/purchases/${r.sourceId}` : r.sourceType === "PAYMENT" ? `/payments/${r.sourceId}` : null);
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-xs text-muted">
        <span>
          {visible.length} entries · newest first
        </span>
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={hideReversed} onChange={(e) => setHideReversed(e.target.checked)} className="accent-[var(--brand)]" />
          Hide reversed entries
        </label>
      </div>
      {/* header row */}
      <div className="hidden grid-cols-[1fr_130px_130px_140px_40px] gap-2 border-b border-border px-4 py-2 text-xs font-medium text-muted md:grid">
        <span>Entry</span>
        <span className="text-right text-get">{incLabel}</span>
        <span className="text-right text-give">{decLabel}</span>
        <span className="text-right">Balance</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {[...visible].reverse().map((r) => {
          const inc = r.effectP > 0;
          const struck = r.status === "REVERSED";
          const link = sourceLink(r);
          return (
            <li key={r.id} id={r.txnNo} className={cn("grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[1fr_130px_130px_140px_40px] md:items-center md:gap-2", highlight === r.txnNo && "bg-warn-soft", r.status !== "ACTIVE" && "bg-surface-2/50")}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("grid size-6 place-items-center rounded-full", (isCust ? inc : !inc) ? "bg-get-soft text-get" : "bg-give-soft text-give")}>
                    {(isCust ? inc : !inc) ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                  </span>
                  <span className={cn("text-sm font-medium", struck && "line-through opacity-60")}>{r.description}</span>
                  {r.status === "REVERSED" ? <Badge tone="warn">Reversed</Badge> : null}
                  {r.status === "REVERSAL" ? <Badge tone="info">Correction</Badge> : null}
                </div>
                <div className="mt-0.5 pl-7.5 text-xs text-muted">
                  {formatDate(r.txnDate)} · {TYPE_LABEL[r.type] ?? r.type}
                  {r.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[r.paymentMethod as PaymentMethod]}` : ""}
                  {r.referenceNo ? ` · Ref ${r.referenceNo}` : ""} · <span title={`Recorded ${formatDateTime(r.createdAt)} by ${r.createdByName ?? "—"}`}>{r.txnNo}</span>
                  {r.attachmentKey ? (
                    <a href={`/api/files/${r.attachmentKey}`} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-brand">
                      <Paperclip className="size-3" /> file
                    </a>
                  ) : null}
                  {link ? (
                    <Link href={link} className="ml-1.5 inline-flex items-center gap-0.5 text-brand">
                      <FileText className="size-3" /> open
                    </Link>
                  ) : null}
                </div>
                {r.notes || r.reversalReason ? <div className="mt-1 pl-7.5 text-xs text-subtle">{r.reversalReason ? `Reversed: ${r.reversalReason}` : r.notes}</div> : null}
              </div>
              {/* mobile amount */}
              <div className="text-right md:hidden">
                <Money value={r.amountP} tone={(isCust ? inc : !inc) ? "get" : "give"} className={cn("font-semibold", struck && "line-through opacity-60")} />
                <div className="text-[11px] text-subtle">
                  Bal <Money value={r.running} abs />
                </div>
              </div>
              <div className="hidden text-right md:block">{inc ? <Money value={r.amountP} tone={isCust ? "get" : "give"} className={cn("font-medium", struck && "line-through opacity-60")} /> : null}</div>
              <div className="hidden text-right md:block">{!inc ? <Money value={r.amountP} tone={isCust ? "give" : "get"} className={cn("font-medium", struck && "line-through opacity-60")} /> : null}</div>
              <div className="hidden text-right md:block">
                <Money value={r.running} tone={isCust ? "auto" : "invert"} abs className="font-semibold" />
              </div>
              <div className="col-span-2 flex justify-end md:col-span-1">
                {canReverse(r) ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Entry actions">
                        <Undo2 />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem danger onSelect={() => setReverseRow(r)}>
                        <RotateCcw /> Reverse this entry
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              </div>
            </li>
          );
        })}
        <li className="flex items-center justify-between px-4 py-3 text-sm text-muted">
          <span>Opening balance</span>
          <Money value={opening} tone={isCust ? "auto" : "invert"} abs className="font-medium" />
        </li>
      </ul>
      <ReasonDialog
        open={!!reverseRow}
        onOpenChange={(o) => !o && setReverseRow(null)}
        title={`Reverse ${reverseRow?.txnNo}?`}
        description="A correcting entry with the opposite amount is added. The original stays visible, marked as reversed."
        confirmLabel="Reverse entry"
        onConfirm={async (reason) => {
          const r = await reverseKhataEntryAction(reverseRow!.id, reason, partyPath);
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success("Entry reversed");
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
