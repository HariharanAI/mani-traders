"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Paperclip, Plus, Search, UserPlus, X } from "lucide-react";
import { Avatar, Button, Dialog, DialogContent, DialogFooter, Field, Input, MoneyInput, Money, Segmented, Select, Spinner, Textarea } from "./ui";
import { useAction, useIdempotencyKey } from "./hooks";
import {
  addKhataEntryAction,
  adjustStockAction,
  createCustomerAction,
  createExpenseAction,
  createProductAction,
  createSupplierAction,
  openInvoicesAction,
  partyBalanceAction,
  recordPaymentAction,
  searchPartiesAction,
  updateCustomerAction,
  updateExpenseAction,
  updateProductAction,
  updateSupplierAction,
  uploadFileAction,
} from "@/app/_actions/business";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/lib/accounts";
import { INDIAN_STATES, GST_RATES } from "@/lib/gst";
import { todayIST } from "@/lib/dates";
import { formatINR, toPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- shared bits
export function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn("rounded-lg border px-1 py-2 text-xs font-medium transition-colors", value === m ? "border-brand bg-brand-soft text-brand" : "border-border-strong text-muted hover:bg-surface-2")}
        >
          {m === "BANK" ? "Bank" : PAYMENT_METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

export function FileAttach({ value, onChange, folder = "attachments", label = "Attach bill / photo" }: { value: string | null; onChange: (key: string | null) => void; folder?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) return toast.error("File is larger than 5 MB");
          setBusy(true);
          const fd = new FormData();
          fd.set("file", f);
          fd.set("folder", folder);
          const res = await uploadFileAction(fd);
          setBusy(false);
          if (res.ok && res.data?.key) onChange(res.data.key);
          else toast.error(res.ok ? "Upload failed" : res.error);
          e.target.value = "";
        }}
      />
      {value ? (
        <span className="inline-flex items-center gap-2 rounded-lg bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand">
          <Paperclip className="size-3.5" />
          <a href={`/api/files/${value}`} target="_blank" rel="noreferrer" className="hover:underline">
            Attached
          </a>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove attachment">
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => ref.current?.click()} loading={busy}>
          <Paperclip /> {label}
        </Button>
      )}
    </div>
  );
}

type PartyOption = { id: string; name: string; mobile: string | null; balance: number; code: string };

export function PartyPicker({ type, value, onChange, onCreateNew, autoFocus, placeholder }: { type: "CUSTOMER" | "SUPPLIER"; value: PartyOption | null; onChange: (p: PartyOption | null) => void; onCreateNew?: (name: string) => void; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PartyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await searchPartiesAction(type, q);
      setLoading(false);
      if (res.ok) setItems(res.data ?? []);
    }, 180);
    return () => clearTimeout(t);
  }, [q, open, type]);
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border-strong bg-surface px-3 py-2">
        <Avatar name={value.name} className="size-8" tone={value.balance > 0 ? "get" : value.balance < 0 ? "give" : "neutral"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{value.name}</div>
          <div className="text-xs text-muted">
            {value.mobile ?? value.code} · Balance <Money value={value.balance} tone={type === "CUSTOMER" ? "auto" : "invert"} />
          </div>
        </div>
        <button type="button" className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" onClick={() => onChange(null)} aria-label="Change">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder ?? (type === "CUSTOMER" ? "Search customer by name or mobile" : "Search supplier")}
        className="pl-9"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            onChange(items[active]);
          }
        }}
        role="combobox"
        aria-expanded={open}
      />
      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop">
          {loading && !items.length ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
              <Spinner /> Searching…
            </div>
          ) : null}
          {items.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(p)}
              className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", i === active ? "bg-surface-2" : "hover:bg-surface-2")}
            >
              <Avatar name={p.name} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block text-xs text-muted">{p.mobile ?? p.code}</span>
              </span>
              <Money value={p.balance} tone={type === "CUSTOMER" ? "auto" : "invert"} className="text-xs font-medium" />
            </button>
          ))}
          {!loading && !items.length ? <div className="px-3 py-3 text-sm text-muted">No {type === "CUSTOMER" ? "customers" : "suppliers"} found.</div> : null}
          {onCreateNew ? (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onCreateNew(q)} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-2.5 py-2.5 text-left text-sm font-medium text-brand hover:bg-brand-soft">
              <UserPlus className="size-4" /> Add new {type === "CUSTOMER" ? "customer" : "supplier"}
              {q ? ` “${q}”` : ""}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- customer / supplier forms
export type CustomerRecord = { id: string; name: string; mobile: string | null; whatsapp: string | null; email: string | null; address: string | null; gstin: string | null; stateCode: string | null; category: string; notes: string | null; openingBalance: string; assignedTo: string | null };

export function CustomerDialog({ open, onOpenChange, customer, initialName, categories = ["Regular", "Wholesale", "Retail"], staff, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: CustomerRecord | null; initialName?: string; categories?: string[]; staff?: { id: string; name: string }[]; onSaved?: (c: { id: string; name: string; mobile: string | null }) => void }) {
  const router = useRouter();
  const edit = !!customer;
  const blank = { name: initialName ?? "", mobile: "", whatsapp: "", email: "", address: "", gstin: "", stateCode: "", category: "Regular", notes: "", openingBalance: "", openingSide: "get" as "get" | "give", assignedTo: "" };
  const [f, setF] = useState(blank);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (customer) {
      const ob = toPaise(customer.openingBalance);
      setF({ name: customer.name, mobile: customer.mobile ?? "", whatsapp: customer.whatsapp && customer.whatsapp !== customer.mobile ? customer.whatsapp : "", email: customer.email ?? "", address: customer.address ?? "", gstin: customer.gstin ?? "", stateCode: customer.stateCode ?? "", category: customer.category, notes: customer.notes ?? "", openingBalance: ob ? String(Math.abs(ob) / 100) : "", openingSide: ob < 0 ? "give" : "get", assignedTo: customer.assignedTo ?? "" });
    } else setF({ ...blank, name: initialName ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer, initialName]);
  const create = useAction(createCustomerAction);
  const update = useAction(updateCustomerAction);
  const pending = create.pending || update.pending;
  const errs = { ...create.fieldErrors, ...update.fieldErrors };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...f, openingBalance: f.openingBalance ? (f.openingSide === "give" ? "-" : "") + f.openingBalance : "0", whatsapp: f.whatsapp || null, assignedTo: f.assignedTo || null, stateCode: f.stateCode || null };
    const res = edit ? await update.run(customer!.id, payload) : await create.run(payload);
    if (res.ok) {
      toast.success(edit ? "Customer updated" : "Customer added");
      onOpenChange(false);
      if (!edit && res.data && onSaved) onSaved(res.data as { id: string; name: string; mobile: string | null });
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={edit ? "Edit customer" : "Add customer"} description={edit ? undefined : "Only the name is required. You can add more later."}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Customer name" required error={errs.name}>
            <Input autoFocus value={f.name} onChange={set("name")} placeholder="e.g. Ravi Kumar" aria-invalid={!!errs.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile number" error={errs.mobile}>
              <Input value={f.mobile} onChange={set("mobile")} inputMode="tel" placeholder="98765 43210" aria-invalid={!!errs.mobile} />
            </Field>
            <Field label="Category">
              <Select value={f.category} onChange={set("category")}>
                {[...new Set([...categories, f.category])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={edit ? "Opening balance" : "Opening balance (optional)"} hint={edit ? "Changing this posts a correction entry; history is kept." : "Amount from your old khata book."} error={errs.openingBalance}>
            <div className="flex gap-2">
              <MoneyInput value={f.openingBalance} onChange={(v) => setF((x) => ({ ...x, openingBalance: v }))} className="flex-1" />
              <Segmented
                value={f.openingSide}
                onChange={(v) => setF((x) => ({ ...x, openingSide: v }))}
                options={[
                  { value: "get", label: "They owe", tone: "get" },
                  { value: "give", label: "We owe", tone: "give" },
                ]}
              />
            </div>
          </Field>
          {more ? (
            <div className="space-y-4 rounded-xl border border-border bg-surface-2/50 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="WhatsApp number" hint="If different from mobile" error={errs.whatsapp}>
                  <Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" />
                </Field>
                <Field label="Email" error={errs.email}>
                  <Input type="email" value={f.email} onChange={set("email")} />
                </Field>
              </div>
              <Field label="Address">
                <Textarea value={f.address} onChange={set("address")} rows={2} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="GSTIN (optional)" error={errs.gstin}>
                  <Input value={f.gstin} onChange={set("gstin")} placeholder="33ABCDE1234F1Z5" className="uppercase" />
                </Field>
                <Field label="State (place of supply)">
                  <Select value={f.stateCode} onChange={set("stateCode")}>
                    <option value="">—</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {staff?.length ? (
                <Field label="Assigned employee" hint="Employees without 'view all customers' only see customers assigned to them.">
                  <Select value={f.assignedTo} onChange={set("assignedTo")}>
                    <option value="">Not assigned</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label="Notes">
                <Textarea value={f.notes} onChange={set("notes")} rows={2} />
              </Field>
            </div>
          ) : (
            <button type="button" onClick={() => setMore(true)} className="inline-flex items-center gap-1 text-sm font-medium text-brand">
              <ChevronDown className="size-4" /> More details (address, GSTIN, WhatsApp, notes)
            </button>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              <Check /> {edit ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type SupplierRecord = { id: string; name: string; contactPerson: string | null; mobile: string | null; whatsapp: string | null; email: string | null; address: string | null; gstin: string | null; stateCode: string | null; notes: string | null; openingBalance: string };

export function SupplierDialog({ open, onOpenChange, supplier, initialName, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; supplier?: SupplierRecord | null; initialName?: string; onSaved?: (s: { id: string; name: string }) => void }) {
  const router = useRouter();
  const edit = !!supplier;
  const blank = { name: initialName ?? "", contactPerson: "", mobile: "", whatsapp: "", email: "", address: "", gstin: "", stateCode: "", notes: "", openingBalance: "", side: "give" as "give" | "get" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (supplier) {
      const ob = toPaise(supplier.openingBalance);
      setF({ name: supplier.name, contactPerson: supplier.contactPerson ?? "", mobile: supplier.mobile ?? "", whatsapp: supplier.whatsapp ?? "", email: supplier.email ?? "", address: supplier.address ?? "", gstin: supplier.gstin ?? "", stateCode: supplier.stateCode ?? "", notes: supplier.notes ?? "", openingBalance: ob ? String(Math.abs(ob) / 100) : "", side: ob < 0 ? "get" : "give" });
    } else setF({ ...blank, name: initialName ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier, initialName]);
  const create = useAction(createSupplierAction);
  const update = useAction(updateSupplierAction);
  const errs = { ...create.fieldErrors, ...update.fieldErrors };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...f, openingBalance: f.openingBalance ? (f.side === "get" ? "-" : "") + f.openingBalance : "0", stateCode: f.stateCode || null, whatsapp: f.whatsapp || null };
    const res = edit ? await update.run(supplier!.id, payload) : await create.run(payload);
    if (res.ok) {
      toast.success(edit ? "Supplier updated" : "Supplier added");
      onOpenChange(false);
      if (!edit && res.data && onSaved) onSaved(res.data as { id: string; name: string });
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={edit ? "Edit supplier" : "Add supplier"}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Supplier / firm name" required error={errs.name}>
            <Input autoFocus value={f.name} onChange={set("name")} aria-invalid={!!errs.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person">
              <Input value={f.contactPerson} onChange={set("contactPerson")} />
            </Field>
            <Field label="Mobile" error={errs.mobile}>
              <Input value={f.mobile} onChange={set("mobile")} inputMode="tel" />
            </Field>
            <Field label="GSTIN" error={errs.gstin}>
              <Input value={f.gstin} onChange={set("gstin")} className="uppercase" />
            </Field>
            <Field label="State">
              <Select value={f.stateCode} onChange={set("stateCode")}>
                <option value="">—</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Email" error={errs.email}>
              <Input value={f.email} onChange={set("email")} type="email" />
            </Field>
            <Field label="WhatsApp" error={errs.whatsapp}>
              <Input value={f.whatsapp} onChange={set("whatsapp")} inputMode="tel" />
            </Field>
          </div>
          <Field label="Address">
            <Textarea value={f.address} onChange={set("address")} rows={2} />
          </Field>
          <Field label="Opening balance" hint={edit ? "Changing this posts a correction entry." : "Amount payable from before using this app."}>
            <div className="flex gap-2">
              <MoneyInput value={f.openingBalance} onChange={(v) => setF((x) => ({ ...x, openingBalance: v }))} className="flex-1" />
              <Segmented value={f.side} onChange={(v) => setF((x) => ({ ...x, side: v }))} options={[{ value: "give", label: "We owe", tone: "give" }, { value: "get", label: "They owe", tone: "get" }]} />
            </div>
          </Field>
          <Field label="Notes">
            <Textarea value={f.notes} onChange={set("notes")} rows={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending}>
              <Check /> {edit ? "Save" : "Add supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- khata entry (You gave / You got)
export function KhataEntryDialog({ open, onOpenChange, party, initialKind = "GAVE_GOODS", canAdjust }: { open: boolean; onOpenChange: (o: boolean) => void; party: { type: "CUSTOMER" | "SUPPLIER"; id: string; name: string; balance: number }; initialKind?: string; canAdjust?: boolean }) {
  const router = useRouter();
  const isCust = party.type === "CUSTOMER";
  type Kind = "GAVE_GOODS" | "GAVE_MONEY" | "GOT_MONEY" | "GOT_GOODS" | "ADJUST_UP" | "ADJUST_DOWN";
  const [kind, setKind] = useState<Kind>(initialKind as Kind);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIST());
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [description, setDescription] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const idem = useIdempotencyKey();
  const action = useAction(addKhataEntryAction);
  useEffect(() => {
    if (open) {
      setKind(initialKind as Kind);
      setAmount("");
      setDescription("");
      setReferenceNo("");
      setNotes("");
      setAttachment(null);
      setDate(todayIST());
      idem.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind]);
  const money = kind === "GAVE_MONEY" || kind === "GOT_MONEY";
  // effect on balance (customer: + owes more; supplier: + we owe more)
  const sign = isCust ? (kind === "GAVE_GOODS" || kind === "GAVE_MONEY" || kind === "ADJUST_UP" ? 1 : -1) : kind === "GOT_GOODS" || kind === "GOT_MONEY" || kind === "ADJUST_UP" ? 1 : -1;
  const amt = /^\d+(\.\d{1,2})?$/.test(amount) ? toPaise(amount) : 0;
  const after = party.balance + sign * amt;
  const gaveSide = kind.startsWith("GAVE");
  const options: { value: Kind; label: string }[] = isCust
    ? [
        { value: "GAVE_GOODS", label: "Goods on credit" },
        { value: "GOT_MONEY", label: "Payment received" },
        { value: "GAVE_MONEY", label: "Money given / refund" },
        { value: "GOT_GOODS", label: "Goods returned" },
        ...(canAdjust ? ([{ value: "ADJUST_DOWN", label: "Discount / write-off" }, { value: "ADJUST_UP", label: "Correction (increase)" }] as { value: Kind; label: string }[]) : []),
      ]
    : [
        { value: "GOT_GOODS", label: "Goods purchased (bill)" },
        { value: "GAVE_MONEY", label: "Payment made" },
        { value: "GOT_MONEY", label: "Refund received" },
        { value: "GAVE_GOODS", label: "Goods returned" },
        ...(canAdjust ? ([{ value: "ADJUST_DOWN", label: "Discount received" }, { value: "ADJUST_UP", label: "Correction (increase)" }] as { value: Kind; label: string }[]) : []),
      ];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await action.run({ partyType: party.type, partyId: party.id, kind, amount, date, description: description || null, paymentMethod: money ? method : null, referenceNo: referenceNo || null, notes: notes || null, attachmentKey: attachment, idempotencyKey: idem.key });
    if (res.ok) {
      toast.success(res.data?.duplicate ? "Already saved" : `Saved · ${res.data?.txnNo}`, { description: `New balance ${formatINR(Math.abs(after))} ${after === 0 ? "(settled)" : ""}` });
      onOpenChange(false);
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={party.name} description={isCust ? "Add to this customer's khata" : "Add to this supplier's ledger"}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => {
              const active = kind === o.value;
              const tone = isCust ? (o.value.startsWith("GAVE") || o.value === "ADJUST_UP" ? "get" : "give") : o.value.startsWith("GOT") || o.value === "ADJUST_UP" ? "give" : "get";
              return (
                <button key={o.value} type="button" onClick={() => setKind(o.value)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors", active ? (tone === "get" ? "border-get bg-get-soft text-get" : "border-give bg-give-soft text-give") : "border-border-strong text-muted hover:bg-surface-2")}>
                  {o.value.startsWith("GAVE") || o.value === "ADJUST_UP" ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                  {o.label}
                </button>
              );
            })}
          </div>
          <Field label="Amount" required error={action.fieldErrors.amount}>
            <MoneyInput size="lg" autoFocus value={amount} onChange={setAmount} aria-invalid={!!action.fieldErrors.amount} />
          </Field>
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            Balance after: <Money value={after} tone={isCust ? "auto" : "invert"} abs className="font-semibold" />{" "}
            <span className="text-muted">{after === 0 ? "· settled" : isCust ? (after > 0 ? "· customer owes you" : "· you owe customer") : after > 0 ? "· you owe supplier" : "· supplier owes you"}</span>
          </div>
          {money ? (
            <Field label="Payment method">
              <MethodPicker value={method} onChange={setMethod} />
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={money ? "UPI / cheque / ref no." : "Bill / reference no."}>
              <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
            </Field>
          </div>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={gaveSide ? "e.g. Rice 2 bags, oil 5L" : "e.g. Part payment"} />
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <FileAttach value={attachment} onChange={setAttachment} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={action.pending} variant={(isCust ? sign > 0 : sign < 0) ? "get" : "give"} disabled={!amt}>
              <Check /> Save entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- payment (receive / make)
export function PaymentDialog({ open, onOpenChange, direction: initialDirection = "IN", party: presetParty, canMake = true, canReceive = true }: { open: boolean; onOpenChange: (o: boolean) => void; direction?: "IN" | "OUT"; party?: { type: "CUSTOMER" | "SUPPLIER"; option: PartyOption } | null; canMake?: boolean; canReceive?: boolean }) {
  const router = useRouter();
  const [direction, setDirection] = useState<"IN" | "OUT">(initialDirection);
  const [partyType, setPartyType] = useState<"CUSTOMER" | "SUPPLIER">(presetParty?.type ?? (initialDirection === "IN" ? "CUSTOMER" : "SUPPLIER"));
  const [party, setParty] = useState<PartyOption | null>(presetParty?.option ?? null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [date, setDate] = useState(todayIST());
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [saleId, setSaleId] = useState("");
  const [invoices, setInvoices] = useState<{ id: string; invoiceNo: string; due: number }[]>([]);
  const [newCustomer, setNewCustomer] = useState<string | null>(null);
  const idem = useIdempotencyKey();
  const action = useAction(recordPaymentAction);
  useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setPartyType(presetParty?.type ?? (initialDirection === "IN" ? "CUSTOMER" : "SUPPLIER"));
      setParty(presetParty?.option ?? null);
      setAmount("");
      setReferenceNo("");
      setNotes("");
      setSaleId("");
      setDate(todayIST());
      idem.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    setInvoices([]);
    if (party && partyType === "CUSTOMER" && direction === "IN") {
      openInvoicesAction(party.id).then((r) => r.ok && setInvoices(r.data ?? []));
    }
  }, [party, partyType, direction]);
  const amt = /^\d+(\.\d{1,2})?$/.test(amount) ? toPaise(amount) : 0;
  const effect = partyType === "CUSTOMER" ? (direction === "IN" ? -amt : amt) : direction === "OUT" ? -amt : amt;
  const after = (party?.balance ?? 0) + effect;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party) return toast.error("Select a party");
    const res = await action.run({ direction, partyType, partyId: party.id, amount, method, date, referenceNo: referenceNo || null, notes: notes || null, saleId: saleId || null, idempotencyKey: idem.key });
    if (res.ok) {
      toast.success(res.data?.duplicate ? "This payment was already saved" : `${direction === "IN" ? "Payment received" : "Payment recorded"} · ${res.data?.paymentNo}`, {
        action: res.data ? { label: "Receipt", onClick: () => window.open(`/api/pdf/receipt/${res.data!.id}`, "_blank") } : undefined,
      });
      onOpenChange(false);
      router.refresh();
    }
  };
  const settleAmount = partyType === "CUSTOMER" ? (direction === "IN" ? party?.balance : -(party?.balance ?? 0)) : direction === "OUT" ? party?.balance : -(party?.balance ?? 0);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={direction === "IN" ? "Receive payment" : "Make payment"} description="Updates the party's balance through the ledger.">
          <form onSubmit={submit} className="space-y-4">
            {!presetParty ? (
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  value={direction}
                  onChange={(d) => {
                    setDirection(d);
                    setPartyType(d === "IN" ? "CUSTOMER" : "SUPPLIER");
                    setParty(null);
                  }}
                  options={[...(canReceive ? [{ value: "IN" as const, label: "Money in", tone: "give" as const }] : []), ...(canMake ? [{ value: "OUT" as const, label: "Money out", tone: "get" as const }] : [])]}
                />
                <Segmented
                  size="sm"
                  value={partyType}
                  onChange={(t) => {
                    setPartyType(t);
                    setParty(null);
                  }}
                  options={[
                    { value: "CUSTOMER", label: "Customer" },
                    { value: "SUPPLIER", label: "Supplier" },
                  ]}
                />
              </div>
            ) : null}
            <Field label={partyType === "CUSTOMER" ? "Customer" : "Supplier"} required>
              <PartyPicker type={partyType} value={party} onChange={setParty} autoFocus={!presetParty} onCreateNew={partyType === "CUSTOMER" ? (n) => setNewCustomer(n) : undefined} />
            </Field>
            <Field label="Amount" required error={action.fieldErrors.amount}>
              <MoneyInput size="lg" value={amount} onChange={setAmount} autoFocus={!!presetParty} />
              {party && settleAmount && settleAmount > 0 ? (
                <button type="button" onClick={() => setAmount((settleAmount / 100).toFixed(2))} className="mt-1.5 text-xs font-medium text-brand hover:underline">
                  Full settlement: {formatINR(settleAmount)}
                </button>
              ) : null}
            </Field>
            {party ? (
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                Balance after payment: <Money value={after} abs tone={partyType === "CUSTOMER" ? "auto" : "invert"} className="font-semibold" />{" "}
                <span className="text-muted">{after === 0 ? "· fully settled" : partyType === "CUSTOMER" ? (after > 0 ? "· still due" : "· advance held") : after > 0 ? "· still payable" : "· advance paid"}</span>
              </div>
            ) : null}
            <Field label="Method">
              <MethodPicker value={method} onChange={setMethod} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" required>
                <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={method === "CHEQUE" ? "Cheque number" : method === "UPI" ? "UPI transaction ID" : "Reference no."}>
                <Input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
              </Field>
            </div>
            {invoices.length ? (
              <Field label="Against invoice (optional)">
                <Select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
                  <option value="">General payment (not linked)</option>
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.invoiceNo} — due {formatINR(i.due)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <p className="text-xs text-subtle">Recording a payment here does not move money. Online payments are only confirmed by your bank or UPI app.</p>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={action.pending} disabled={!party || !amt} variant={direction === "IN" ? "give" : "get"}>
                <Check /> {direction === "IN" ? "Save receipt" : "Save payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CustomerDialog
        open={newCustomer !== null}
        onOpenChange={(o) => !o && setNewCustomer(null)}
        initialName={newCustomer ?? ""}
        onSaved={(c) => {
          setParty({ id: c.id, name: c.name, mobile: c.mobile, balance: 0, code: "" });
          setNewCustomer(null);
          partyBalanceAction("CUSTOMER", c.id).then((r) => r.ok && setParty((p) => (p ? { ...p, balance: r.data ?? 0 } : p)));
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- product
export type ProductRecord = { id: string; name: string; sku: string | null; barcode: string | null; hsnCode: string | null; categoryId: string | null; unit: string; purchasePrice: string; sellingPrice: string; gstRate: string; minStock: string; imageKey: string | null };

export function ProductDialog({ open, onOpenChange, product, categories, gstEnabled }: { open: boolean; onOpenChange: (o: boolean) => void; product?: ProductRecord | null; categories: { id: string; name: string }[]; gstEnabled: boolean }) {
  const router = useRouter();
  const edit = !!product;
  const blank = { name: "", sku: "", barcode: "", hsnCode: "", categoryId: "", newCategory: "", unit: "pcs", purchasePrice: "", sellingPrice: "", gstRate: "0", minStock: "", openingStock: "", imageKey: null as string | null };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (product) setF({ name: product.name, sku: product.sku ?? "", barcode: product.barcode ?? "", hsnCode: product.hsnCode ?? "", categoryId: product.categoryId ?? "", newCategory: "", unit: product.unit, purchasePrice: String(Number(product.purchasePrice) || ""), sellingPrice: String(Number(product.sellingPrice) || ""), gstRate: String(Number(product.gstRate)), minStock: String(Number(product.minStock) || ""), openingStock: "", imageKey: product.imageKey });
    else setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product]);
  const create = useAction(createProductAction);
  const update = useAction(updateProductAction);
  const errs = { ...create.fieldErrors, ...update.fieldErrors };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const margin = toPaise(f.sellingPrice || "0") - toPaise(f.purchasePrice || "0");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...f, categoryId: f.categoryId === "__new" ? null : f.categoryId || null, newCategory: f.categoryId === "__new" ? f.newCategory : null };
    const res = edit ? await update.run(product!.id, payload) : await create.run(payload);
    if (res.ok) {
      toast.success(edit ? "Product updated" : "Product added");
      onOpenChange(false);
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={edit ? "Edit product" : "Add product"} wide>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Product name" required error={errs.name} className="sm:col-span-2">
              <Input autoFocus value={f.name} onChange={set("name")} />
            </Field>
            <Field label="Unit">
              <Select value={f.unit} onChange={set("unit")}>
                {["pcs", "kg", "g", "litre", "ml", "bag", "box", "pack", "dozen", "metre", "bundle", "set"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase price" error={errs.purchasePrice}>
              <MoneyInput value={f.purchasePrice} onChange={(v) => setF((x) => ({ ...x, purchasePrice: v }))} />
            </Field>
            <Field label="Selling price" error={errs.sellingPrice} hint={margin ? `Margin ${formatINR(margin)} per ${f.unit}` : undefined}>
              <MoneyInput value={f.sellingPrice} onChange={(v) => setF((x) => ({ ...x, sellingPrice: v }))} />
            </Field>
            <Field label="GST rate" hint={gstEnabled ? undefined : "GST is off in Settings"}>
              <Select value={f.gstRate} onChange={set("gstRate")}>
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={f.categoryId} onChange={set("categoryId")}>
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">+ New category…</option>
              </Select>
            </Field>
            {f.categoryId === "__new" ? (
              <Field label="New category name">
                <Input value={f.newCategory} onChange={set("newCategory")} />
              </Field>
            ) : null}
            <Field label="SKU" error={errs.sku}>
              <Input value={f.sku} onChange={set("sku")} />
            </Field>
            <Field label="Barcode">
              <Input value={f.barcode} onChange={set("barcode")} />
            </Field>
            <Field label="HSN code">
              <Input value={f.hsnCode} onChange={set("hsnCode")} inputMode="numeric" />
            </Field>
            <Field label="Low-stock alert at" error={errs.minStock}>
              <Input value={f.minStock} onChange={set("minStock")} inputMode="decimal" placeholder="0" />
            </Field>
            {!edit ? (
              <Field label="Opening stock" hint="Valued at purchase price" error={errs.openingStock}>
                <Input value={f.openingStock} onChange={set("openingStock")} inputMode="decimal" placeholder="0" />
              </Field>
            ) : null}
          </div>
          <FileAttach value={f.imageKey} onChange={(k) => setF((x) => ({ ...x, imageKey: k }))} folder="products" label="Product image" />
          {edit ? <p className="text-xs text-subtle">To change stock quantity, use Stock adjustment so every change is recorded.</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending}>
              <Check /> {edit ? "Save" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StockAdjustDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product: { id: string; name: string; unit: string; stock: string; avgCost: string } }) {
  const router = useRouter();
  const [kind, setKind] = useState<"STOCK_IN" | "STOCK_OUT" | "SET">("STOCK_IN");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIST());
  const idem = useIdempotencyKey();
  const action = useAction(adjustStockAction);
  useEffect(() => {
    if (open) {
      setQuantity("");
      setReason("");
      setUnitCost("");
      idem.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await action.run({ productId: product.id, kind, quantity, unitCost: unitCost || undefined, reason, date, idempotencyKey: idem.key });
    if (res.ok) {
      toast.success("Stock updated");
      onOpenChange(false);
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Stock adjustment" description={`${product.name} · current stock ${product.stock} ${product.unit}`}>
        <form onSubmit={submit} className="space-y-4">
          <Segmented value={kind} onChange={setKind} className="w-full" options={[{ value: "STOCK_IN", label: "Stock in", tone: "give" }, { value: "STOCK_OUT", label: "Stock out", tone: "get" }, { value: "SET", label: "Set count" }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "SET" ? "Counted quantity" : "Quantity"} required error={action.fieldErrors.quantity}>
              <Input autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" />
            </Field>
            {kind === "STOCK_IN" ? (
              <Field label="Unit cost" hint={`Avg cost now ${formatINR(toPaise(product.avgCost))}`}>
                <MoneyInput value={unitCost} onChange={setUnitCost} />
              </Field>
            ) : (
              <Field label="Date">
                <Input type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Reason" required error={action.fieldErrors.reason}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "STOCK_OUT" ? "Damaged / expired / own use" : kind === "SET" ? "Physical stock count" : "Received without bill / found"} />
          </Field>
          <p className="text-xs text-subtle">Purchases and sales update stock automatically. Use this only for corrections; the value change is posted to the ledger.</p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={action.pending}>
              <Check /> Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- expense
export type ExpenseRecord = { id: string; expenseDate: string; category: string; amount: string; paymentMethod: PaymentMethod; referenceNo: string | null; payee: string | null; description: string | null; receiptKey: string | null };

export function ExpenseDialog({ open, onOpenChange, expense }: { open: boolean; onOpenChange: (o: boolean) => void; expense?: ExpenseRecord | null }) {
  const router = useRouter();
  const edit = !!expense;
  const [f, setF] = useState({ date: todayIST(), category: "Miscellaneous", amount: "", paymentMethod: "CASH" as PaymentMethod, referenceNo: "", payee: "", description: "", receiptKey: null as string | null });
  const idem = useIdempotencyKey();
  useEffect(() => {
    if (!open) return;
    idem.reset();
    if (expense) setF({ date: expense.expenseDate, category: expense.category, amount: String(toPaise(expense.amount) / 100), paymentMethod: expense.paymentMethod, referenceNo: expense.referenceNo ?? "", payee: expense.payee ?? "", description: expense.description ?? "", receiptKey: expense.receiptKey });
    else setF({ date: todayIST(), category: "Miscellaneous", amount: "", paymentMethod: "CASH", referenceNo: "", payee: "", description: "", receiptKey: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense]);
  const create = useAction(createExpenseAction);
  const update = useAction(updateExpenseAction);
  const errs = { ...create.fieldErrors, ...update.fieldErrors };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...f, category: f.category as never, idempotencyKey: idem.key, referenceNo: f.referenceNo || null, payee: f.payee || null, description: f.description || null };
    const res = edit ? await update.run(expense!.id, payload) : await create.run(payload);
    if (res.ok) {
      toast.success(edit ? "Expense updated" : "Expense added");
      onOpenChange(false);
      router.refresh();
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={edit ? "Edit expense" : "Add expense"} description={edit ? "Amount, category, date or method changes are re-posted with a reversal for audit." : undefined}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Amount" required error={errs.amount}>
            <MoneyInput size="lg" autoFocus value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} />
          </Field>
          <Field label="Category">
            <div className="flex flex-wrap gap-1.5">
              {EXPENSE_CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => setF((x) => ({ ...x, category: c.key }))} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", f.category === c.key ? "border-brand bg-brand-soft text-brand" : "border-border-strong text-muted hover:bg-surface-2")}>
                  {c.key}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Paid via">
            <MethodPicker value={f.paymentMethod} onChange={(m) => setF((x) => ({ ...x, paymentMethod: m }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <Input type="date" value={f.date} max={todayIST()} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} />
            </Field>
            <Field label="Paid to">
              <Input value={f.payee} onChange={(e) => setF((x) => ({ ...x, payee: e.target.value }))} placeholder="e.g. TNEB, landlord" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference no.">
              <Input value={f.referenceNo} onChange={(e) => setF((x) => ({ ...x, referenceNo: e.target.value }))} />
            </Field>
            <Field label="Description">
              <Input value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} />
            </Field>
          </div>
          <FileAttach value={f.receiptKey} onChange={(k) => setF((x) => ({ ...x, receiptKey: k }))} folder="receipts" label="Upload receipt" />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending}>
              <Check /> {edit ? "Save" : "Add expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- reason confirm
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", onConfirm, extra, danger = true }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; onConfirm: (reason: string) => Promise<boolean>; extra?: React.ReactNode; danger?: boolean }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await onConfirm(reason);
            setBusy(false);
            if (ok) onOpenChange(false);
          }}
          className="space-y-4"
        >
          <Field label="Reason" required hint="Saved in the audit log.">
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          {extra}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 3}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useOpen() {
  const [open, setOpen] = useState(false);
  return useMemo(() => ({ open, setOpen, show: () => setOpen(true) }), [open]);
}

export { Plus };
