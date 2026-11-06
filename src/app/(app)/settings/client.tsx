"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Wallet, Bell, Building2, Check, CircleCheck, CircleX, Database, FileText, MessageCircle, Percent, SlidersHorizontal, Upload } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Input, MoneyInput, Segmented, Select, Switch, Textarea } from "@/components/ui";
import { FileAttach } from "@/components/forms";
import { useAction } from "@/components/hooks";
import { backupNowAction, setLogoAction, updateSettingsAction } from "@/app/_actions/business";
import { INDIAN_STATES, isValidGSTIN } from "@/lib/gst";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type S = {
  businessName: string;
  legalName: string | null;
  tagline: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logoKey: string | null;
  gstRegistered: boolean;
  gstin: string | null;
  gstScheme: string;
  pricesIncludeTax: boolean;
  invoicePrefix: string;
  receiptPrefix: string;
  purchasePrefix: string;
  invoiceTerms: string | null;
  invoiceFooter: string | null;
  bankDetails: string | null;
  upiId: string | null;
  fyStartMonth: number;
  currency: string;
  dateFormat: string;
  timezone: string;
  creditPeriodDays: number;
  allowNegativeStock: boolean;
  unusualTxnThreshold: string;
  whatsappMode: string;
  whatsappTemplates: Record<string, { name: string; language: string }>;
  notificationPrefs: Record<string, boolean>;
  backupEnabled: boolean;
  backupRetentionDays: number;
  lastBackupAt: string | null;
};

const TABS = [
  { key: "business", label: "Business", icon: Building2 },
  { key: "gst", label: "GST & tax", icon: Percent },
  { key: "invoice", label: "Invoices", icon: FileText },
  { key: "prefs", label: "Preferences", icon: SlidersHorizontal },
  { key: "cash", label: "Cash & bank", icon: Wallet },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "data", label: "Data & backup", icon: Database },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function SettingsForm({
  settings,
  initialTab,
  currentFy,
  whatsapp,
  messageTypes,
  notificationTypes,
  backups,
  storage,
  cashbook,
}: {
  settings: S;
  initialTab?: string;
  currentFy: string;
  whatsapp: { configured: boolean; webhookUrl: string; verifyTokenSet: boolean; appSecretSet: boolean };
  messageTypes: { key: string; label: string; params: string }[];
  notificationTypes: { key: string; label: string }[];
  backups: { name: string; size: number; at: string }[];
  storage: { driver: string; db: string };
  cashbook: React.ReactNode;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<TabKey>((TABS.find((t) => t.key === initialTab)?.key as TabKey) ?? "business");
  const [f, setF] = useState<S>(settings);
  const save = useAction(updateSettingsAction);
  const logo = useAction(setLogoAction);
  const backup = useAction(backupNowAction);
  const set = <K extends keyof S>(k: K, v: S[K]) => setF((x) => ({ ...x, [k]: v }));
  const txt = (k: keyof S) => ({ value: (f[k] as string | null) ?? "", onChange: (e: { target: { value: string } }) => set(k, e.target.value as never) });
  const errs = save.fieldErrors;
  const gstinOk = !f.gstin || isValidGSTIN(f.gstin);

  const submit = async () => {
    const r = await save.run({
      ...f,
      phone: f.phone || null,
      email: f.email || null,
      gstin: f.gstRegistered ? f.gstin || null : f.gstin || null,
      stateCode: f.stateCode || null,
      gstScheme: f.gstScheme as "REGULAR" | "COMPOSITION",
      whatsappMode: f.whatsappMode as "MANUAL" | "CLOUD_API",
    });
    if (r.ok) {
      toast.success("Settings saved");
      router.refresh();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto scrollbar-none lg:flex-col">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium", tab === t.key ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </nav>
      <div className="space-y-4">
        {tab === "business" ? (
          <Card>
            <CardHeader title="Business profile" description="Printed on invoices, receipts and statements" />
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <Field label="Business name" required error={errs.businessName}>
                <Input {...txt("businessName")} />
              </Field>
              <Field label="Legal name (if different)">
                <Input {...txt("legalName")} />
              </Field>
              <Field label="Tagline" className="sm:col-span-2">
                <Input {...txt("tagline")} placeholder="e.g. Wholesale grocery & provisions" />
              </Field>
              <Field label="Address line 1" className="sm:col-span-2">
                <Input {...txt("addressLine1")} />
              </Field>
              <Field label="Address line 2" className="sm:col-span-2">
                <Input {...txt("addressLine2")} />
              </Field>
              <Field label="City">
                <Input {...txt("city")} />
              </Field>
              <Field label="PIN code">
                <Input {...txt("pincode")} inputMode="numeric" />
              </Field>
              <Field label="State">
                <Select
                  value={f.stateCode ?? ""}
                  onChange={(e) => {
                    const st = INDIAN_STATES.find((s) => s.code === e.target.value);
                    setF((x) => ({ ...x, stateCode: e.target.value || null, state: st?.name ?? null }));
                  }}
                >
                  <option value="">—</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Phone" error={errs.phone}>
                <Input {...txt("phone")} inputMode="tel" />
              </Field>
              <Field label="Email" error={errs.email}>
                <Input {...txt("email")} type="email" />
              </Field>
              <Field label="Logo" hint="PNG or JPG, shown on PDFs">
                <div className="flex items-center gap-3">
                  {f.logoKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${f.logoKey}`} alt="Logo" className="size-12 rounded-lg border border-border object-contain" />
                  ) : null}
                  <FileAttach
                    folder="logos"
                    label="Upload logo"
                    value={null}
                    onChange={async (k) => {
                      const r = await logo.run(k);
                      if (r.ok) {
                        set("logoKey", k);
                        toast.success("Logo updated");
                      }
                    }}
                  />
                </div>
              </Field>
            </div>
          </Card>
        ) : null}

        {tab === "gst" ? (
          <Card>
            <CardHeader title="GST configuration" description="Set this to match your actual registration. Invoices change from bill of supply to tax invoice accordingly." />
            <div className="space-y-5 p-4 sm:p-5">
              <Switch checked={f.gstRegistered} onChange={(v) => set("gstRegistered", v)} label="Business is GST registered" description="Off: bills of supply without tax." />
              {f.gstRegistered ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="GSTIN" required error={errs.gstin ?? (!gstinOk ? "Check the GSTIN format" : undefined)}>
                      <Input value={f.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className="uppercase" placeholder="33ABCDE1234F1Z5" />
                    </Field>
                    <Field label="Scheme">
                      <Segmented value={f.gstScheme} onChange={(v) => set("gstScheme", v)} options={[{ value: "REGULAR", label: "Regular" }, { value: "COMPOSITION", label: "Composition" }]} />
                    </Field>
                  </div>
                  {f.gstScheme === "COMPOSITION" ? (
                    <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Composition dealers cannot collect GST from customers: invoices are issued as bills of supply and purchase GST is added to stock cost.</p>
                  ) : (
                    <Switch checked={f.pricesIncludeTax} onChange={(v) => set("pricesIncludeTax", v)} label="Selling prices include GST" description="On: the rate you enter is the final price (tax is back-calculated). Off: GST is added on top." />
                  )}
                  <p className="text-xs text-muted">Intra-state sales use CGST + SGST; inter-state sales (customer state ≠ your state) use IGST. Your state: {INDIAN_STATES.find((s) => s.code === f.stateCode)?.name ?? "not set — set it in Business"}.</p>
                </>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "invoice" ? (
          <Card>
            <CardHeader title="Invoice & receipt configuration" description={`Numbers restart every financial year, e.g. ${f.invoicePrefix}/${currentFy.slice(2, 4)}-${currentFy.slice(5)}/0001`} />
            <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
              <Field label="Invoice prefix" error={errs.invoicePrefix}>
                <Input {...txt("invoicePrefix")} maxLength={6} />
              </Field>
              <Field label="Receipt prefix" error={errs.receiptPrefix}>
                <Input {...txt("receiptPrefix")} maxLength={6} />
              </Field>
              <Field label="Purchase prefix" error={errs.purchasePrefix}>
                <Input {...txt("purchasePrefix")} maxLength={6} />
              </Field>
              <Field label="Bank details (printed on invoice)" className="sm:col-span-2">
                <Textarea {...txt("bankDetails")} rows={3} placeholder={"Bank: …\nA/c: …\nIFSC: …"} />
              </Field>
              <Field label="UPI ID">
                <Input {...txt("upiId")} placeholder="business@upi" />
              </Field>
              <Field label="Terms & conditions" className="sm:col-span-3">
                <Textarea {...txt("invoiceTerms")} rows={3} />
              </Field>
              <Field label="Footer note" className="sm:col-span-3">
                <Input {...txt("invoiceFooter")} />
              </Field>
            </div>
          </Card>
        ) : null}

        {tab === "prefs" ? (
          <Card>
            <CardHeader title="Preferences" />
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <Field label="Financial year starts in" hint={`Current FY: ${currentFy}`}>
                <Select value={String(f.fyStartMonth)} onChange={(e) => set("fyStartMonth", Number(e.target.value))}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Credit period (days)" hint="Customers with no payment for longer are marked overdue" error={errs.creditPeriodDays}>
                <Input type="number" min={1} max={365} value={f.creditPeriodDays} onChange={(e) => set("creditPeriodDays", Number(e.target.value))} />
              </Field>
              <Field label="Flag transactions at or above" hint="Creates an 'unusual transaction' alert" error={errs.unusualTxnThreshold}>
                <MoneyInput value={f.unusualTxnThreshold} onChange={(v) => set("unusualTxnThreshold", v)} />
              </Field>
              <Field label="Currency · Date format · Timezone">
                <Input value={`INR (₹) · DD-MM-YYYY · Asia/Kolkata`} disabled />
              </Field>
              <div className="sm:col-span-2">
                <Switch checked={f.allowNegativeStock} onChange={(v) => set("allowNegativeStock", v)} label="Allow selling below zero stock for everyone" description="Off (recommended): only users with the 'negative stock' permission can override per sale." />
              </div>
              <Field label="Theme (this device)" className="sm:col-span-2">
                <Segmented value={theme ?? "system"} onChange={setTheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} />
              </Field>
            </div>
          </Card>
        ) : null}

        {tab === "cash" ? cashbook : null}

        {tab === "whatsapp" ? (
          <Card>
            <CardHeader title="WhatsApp integration" />
            <div className="space-y-5 p-4 sm:p-5">
              <div className="grid gap-2 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
                <Status ok={whatsapp.configured} label="Cloud API credentials" />
                <Status ok={whatsapp.verifyTokenSet} label="Webhook verify token" />
                <Status ok={whatsapp.appSecretSet} label="Webhook signature secret" />
              </div>
              <p className="text-sm text-muted">
                Credentials are server environment variables (never stored in the database): <code className="rounded bg-surface-2 px-1">WHATSAPP_PHONE_NUMBER_ID</code>, <code className="rounded bg-surface-2 px-1">WHATSAPP_ACCESS_TOKEN</code>, <code className="rounded bg-surface-2 px-1">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>, <code className="rounded bg-surface-2 px-1">WHATSAPP_APP_SECRET</code>. Webhook URL for Meta: <code className="rounded bg-surface-2 px-1">{whatsapp.webhookUrl}</code>
              </p>
              <Field label="Sending mode">
                <Segmented value={f.whatsappMode} onChange={(v) => set("whatsappMode", v)} options={[{ value: "MANUAL", label: "Manual (open WhatsApp)" }, { value: "CLOUD_API", label: "WhatsApp Business API" }]} />
              </Field>
              {f.whatsappMode === "CLOUD_API" && !whatsapp.configured ? <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">API mode is selected but credentials are not configured on the server. Messages will fall back to manual sharing.</p> : null}
              <div>
                <div className="mb-2 text-sm font-medium">Approved message templates</div>
                <p className="mb-3 text-xs text-muted">Business-initiated messages need templates approved by Meta. Enter each template&apos;s exact name and language code. Leave empty to send plain text (only works within 24 hours of the customer messaging you).</p>
                <div className="space-y-2">
                  {messageTypes.map((m) => {
                    const t = f.whatsappTemplates?.[m.key] ?? { name: "", language: "en" };
                    const upd = (patch: Partial<typeof t>) => set("whatsappTemplates", { ...f.whatsappTemplates, [m.key]: { ...t, ...patch } });
                    return (
                      <div key={m.key} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_200px_90px] sm:items-center">
                        <div>
                          <div className="text-sm font-medium">{m.label}</div>
                          <div className="text-xs text-subtle">{m.params}</div>
                        </div>
                        <Input placeholder="template_name" value={t.name} onChange={(e) => upd({ name: e.target.value })} />
                        <Input placeholder="en" value={t.language} onChange={(e) => upd({ language: e.target.value })} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {tab === "notifications" ? (
          <Card>
            <CardHeader title="Notification preferences" description="Alerts shown in the notification center" />
            <div className="space-y-3 p-4 sm:p-5">
              {notificationTypes.map((n) => (
                <Switch key={n.key} checked={f.notificationPrefs?.[n.key] !== false} onChange={(v) => set("notificationPrefs", { ...f.notificationPrefs, [n.key]: v })} label={n.label} />
              ))}
            </div>
          </Card>
        ) : null}

        {tab === "data" ? (
          <Card>
            <CardHeader title="Data & backups" description={`${storage.db} · files on ${storage.driver}`} />
            <div className="space-y-5 p-4 sm:p-5">
              <Switch checked={f.backupEnabled} onChange={(v) => set("backupEnabled", v)} label="Automatic daily backup" description="Runs with the daily job (overdue alerts & summary). Production: also schedule /api/cron/daily." />
              <Field label="Keep backups for (days)" className="max-w-xs">
                <Input type="number" min={1} value={f.backupRetentionDays} onChange={(e) => set("backupRetentionDays", Number(e.target.value))} />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  loading={backup.pending}
                  onClick={async () => {
                    const r = await backup.run();
                    if (r.ok) {
                      toast.success(`Backup created: ${r.data!.name}`);
                      router.refresh();
                    }
                  }}
                >
                  <Upload /> Back up now
                </Button>
                <span className="text-sm text-muted">Last backup: {f.lastBackupAt ? formatDateTime(f.lastBackupAt) : "never"}</span>
              </div>
              {backups.length ? (
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {backups.slice(0, 10).map((b) => (
                    <li key={b.name} className="flex justify-between gap-3 px-3 py-2">
                      <span className="truncate font-mono text-xs">{b.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {(b.size / 1024 / 1024).toFixed(2)} MB · {formatDateTime(b.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted">Backups are written to the server&apos;s BACKUP_DIR. Copy them off the server regularly (see README → Backup & recovery).</p>
            </div>
          </Card>
        ) : null}

        <div className={cn("sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-10 flex justify-end rounded-xl border border-border bg-surface/95 p-3 shadow-pop backdrop-blur lg:bottom-4", tab === "cash" && "hidden")}>
          <Button onClick={submit} loading={save.pending}>
            <Check /> Save settings
          </Button>
        </div>
      </div>
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CircleCheck className="size-4 text-give" /> : <CircleX className="size-4 text-subtle" />}
      <span>{label}</span>
      <Badge tone={ok ? "give" : "neutral"} className="ml-auto">
        {ok ? "set" : "not set"}
      </Badge>
    </div>
  );
}
