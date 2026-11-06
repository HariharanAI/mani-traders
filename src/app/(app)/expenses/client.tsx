"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, MoreHorizontal, Paperclip, Pencil, Plus } from "lucide-react";
import { Badge, Button, Menu, MenuContent, MenuItem, MenuTrigger, Money } from "@/components/ui";
import { ExpenseDialog, ReasonDialog, type ExpenseRecord } from "@/components/forms";
import { useShell } from "@/components/shell";
import { voidExpenseAction } from "@/app/_actions/business";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/accounts";

export function AddExpenseButton() {
  const { can } = useShell();
  const [open, setOpen] = useState(false);
  if (!can("expenses.manage")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Add expense
      </Button>
      <ExpenseDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type Row = ExpenseRecord & { expenseNo: string; status: string; amountP: number; by: string | null };

export function ExpenseRows({ rows }: { rows: Row[] }) {
  const { can } = useShell();
  const router = useRouter();
  const [edit, setEdit] = useState<Row | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((e) => (
          <li key={e.id} className={`flex items-center gap-3 px-4 py-3 ${e.status !== "ACTIVE" ? "opacity-60" : ""}`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-medium">{e.category}</span>
                {e.payee ? <span className="truncate text-sm text-muted">· {e.payee}</span> : null}
                {e.status !== "ACTIVE" ? <Badge tone="warn">Voided</Badge> : null}
              </span>
              <span className="block text-xs text-muted">
                {formatDate(e.expenseDate)} · {PAYMENT_METHOD_LABEL[e.paymentMethod]} · {e.expenseNo}
                {e.description ? ` · ${e.description}` : ""}
                {e.receiptKey ? (
                  <a href={`/api/files/${e.receiptKey}`} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-brand">
                    <Paperclip className="size-3" /> receipt
                  </a>
                ) : null}
              </span>
            </span>
            <Money value={e.amountP} className={`font-semibold ${e.status !== "ACTIVE" ? "line-through" : ""}`} />
            {can("expenses.manage") && e.status === "ACTIVE" ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Expense actions">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem onSelect={() => setEdit(e)}>
                    <Pencil /> Edit
                  </MenuItem>
                  <MenuItem danger onSelect={() => setVoiding(e)}>
                    <Ban /> Void
                  </MenuItem>
                </MenuContent>
              </Menu>
            ) : (
              <span className="w-8" />
            )}
          </li>
        ))}
      </ul>
      <ExpenseDialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} expense={edit} />
      <ReasonDialog
        open={!!voiding}
        onOpenChange={(o) => !o && setVoiding(null)}
        title={`Void expense ${voiding?.expenseNo}?`}
        description="The ledger entry is reversed. The expense stays visible as voided."
        confirmLabel="Void expense"
        onConfirm={async (reason) => {
          const r = await voidExpenseAction(voiding!.id, reason);
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success("Expense voided");
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
