"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, MoneyInput, Money, Segmented, Select } from "@/components/ui";
import { useAction } from "@/components/hooks";
import { addCashEntryAction } from "@/app/_actions/business";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { formatDate, todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";

const ACCOUNTS: PaymentMethod[] = ["CASH", "BANK", "UPI", "OTHER"];

export function CashBook({ balances, entries }: { balances: { code: string; name: string; balance: number }[]; entries: { id: string; no: string; date: string; memo: string; total: number }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<"OPENING" | "CAPITAL" | "DRAWINGS" | "TRANSFER">("OPENING");
  const [account, setAccount] = useState<PaymentMethod>("CASH");
  const [toAccount, setToAccount] = useState<PaymentMethod>("BANK");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIST());
  const [note, setNote] = useState("");
  const action = useAction(addCashEntryAction);
  return (
    <>
      <Card>
        <CardHeader title="Cash & bank balances" description="Calculated from the ledger" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
          {balances.map((b) => (
            <div key={b.code} className="rounded-lg bg-surface-2 p-3">
              <div className="text-xs text-muted">{b.name}</div>
              <Money value={b.balance} className={`mt-1 block text-lg font-semibold ${b.balance < 0 ? "text-get" : ""}`} />
            </div>
          ))}
        </div>
        {balances.some((b) => b.balance < 0) ? <p className="px-5 pb-4 text-xs text-get">A negative balance usually means the opening cash/bank balance has not been entered yet.</p> : null}
      </Card>
      <Card>
        <CardHeader title="Add cash / bank entry" description="Opening balances, owner's capital, drawings and transfers between accounts" />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await action.run({ kind, account, toAccount: kind === "TRANSFER" ? toAccount : undefined, amount, date, note: note || null });
            if (r.ok) {
              toast.success("Entry saved");
              setAmount("");
              setNote("");
              router.refresh();
            }
          }}
        >
          <Segmented value={kind} onChange={setKind} options={[{ value: "OPENING", label: "Opening balance" }, { value: "CAPITAL", label: "Capital in" }, { value: "DRAWINGS", label: "Drawings" }, { value: "TRANSFER", label: "Transfer" }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "TRANSFER" ? "From account" : "Account"}>
              <Select value={account} onChange={(e) => setAccount(e.target.value as PaymentMethod)}>
                {ACCOUNTS.map((a) => (
                  <option key={a} value={a}>
                    {a === "BANK" ? "Bank" : PAYMENT_METHOD_LABEL[a]}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === "TRANSFER" ? (
              <Field label="To account">
                <Select value={toAccount} onChange={(e) => setToAccount(e.target.value as PaymentMethod)}>
                  {ACCOUNTS.map((a) => (
                    <option key={a} value={a}>
                      {a === "BANK" ? "Bank" : PAYMENT_METHOD_LABEL[a]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Amount" required error={action.fieldErrors.amount}>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Date">
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "TRANSFER" ? "e.g. Cash deposited in SBI" : ""} />
          </Field>
          <Button type="submit" loading={action.pending} disabled={!amount}>
            <Check /> Save entry
          </Button>
        </form>
        {entries.length ? (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 px-5 py-2.5">
                <span>
                  {e.memo}
                  <span className="block text-xs text-muted">
                    {formatDate(e.date)} · {e.no}
                  </span>
                </span>
                <span className="tnum font-medium">{formatINR(e.total)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
