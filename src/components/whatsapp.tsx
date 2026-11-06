"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FileText, MessageCircle, Send, Share2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, Segmented, Spinner, Switch, Textarea } from "./ui";
import { prepareMessageAction, sendMessageAction } from "@/app/_actions/whatsapp";

type Target =
  | { kind: "party"; type: "REMINDER" | "PAYMENT_CONFIRMATION" | "STATEMENT" | "INVOICE" | "RECEIPT" | "MONTHLY_SUMMARY"; partyType: "CUSTOMER" | "SUPPLIER"; partyId: string }
  | { kind: "invoice"; saleId: string }
  | { kind: "receipt"; paymentId: string };

function pdfUrl(t: Target): string | null {
  if (t.kind === "invoice") return `/api/pdf/invoice/${t.saleId}`;
  if (t.kind === "receipt") return `/api/pdf/receipt/${t.paymentId}`;
  if (t.type === "STATEMENT" || t.type === "MONTHLY_SUMMARY") return `/api/pdf/statement/${t.partyType.toLowerCase()}/${t.partyId}`;
  return null;
}

/**
 * Sends via the WhatsApp Cloud API when configured, otherwise opens WhatsApp
 * with the message pre-filled. Manual shares are recorded as "opened", never
 * as "delivered". On phones, PDFs are shared as files through the share sheet.
 */
export function WhatsAppDialog({ open, onOpenChange, target }: { open: boolean; onOpenChange: (o: boolean) => void; target: Target }) {
  const [loading, setLoading] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [cloud, setCloud] = useState(false);
  const [mode, setMode] = useState<"manual" | "cloud">("manual");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const pdf = pdfUrl(target);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    prepareMessageAction(target).then((r) => {
      setLoading(false);
      if (!r.ok) {
        toast.error(r.error);
        onOpenChange(false);
        return;
      }
      setTo(r.data!.to);
      setText(r.data!.text);
      setCloud(r.data!.cloud);
      setMode(r.data!.cloud ? "cloud" : "manual");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shareFile = async () => {
    if (!pdf) return false;
    try {
      const res = await fetch(pdf);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "document.pdf";
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return true;
      }
    } catch {
      /* fall through to wa.me */
    }
    return false;
  };

  const send = async () => {
    setBusy(true);
    const r = await sendMessageAction(target, { mode, to, text, attachPdf: attach && !!pdf });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    const data = r.data!;
    if (data.mode === "manual") {
      if (attach && pdf && (await shareFile())) {
        toast.success("Shared");
      } else {
        window.open(data.link, "_blank", "noopener");
        if (attach && pdf) toast.info("WhatsApp opened with the message. Attach the downloaded PDF in WhatsApp.", { duration: 6000 });
        if (attach && pdf) window.open(`${pdf}?download=1`, "_blank");
      }
    } else {
      toast.success("Accepted by WhatsApp. Delivery status will update in the message log.");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Send on WhatsApp" description={cloud ? "WhatsApp Business API is connected." : "Opens WhatsApp with this message ready to send."}>
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted">
            <Spinner /> Preparing message…
          </div>
        ) : (
          <div className="space-y-4">
            {cloud ? (
              <Segmented
                value={mode}
                onChange={setMode}
                className="w-full"
                options={[
                  { value: "cloud", label: "Send via API" },
                  { value: "manual", label: "Open WhatsApp" },
                ]}
              />
            ) : null}
            <Field label="WhatsApp number" required>
              <Input value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="98765 43210" />
            </Field>
            <Field label="Message" hint={mode === "cloud" ? "With an approved template configured, the template text is sent with these values." : undefined}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-[inherit] text-sm" />
            </Field>
            {pdf ? (
              <div className="rounded-xl border border-border p-3">
                <Switch checked={attach} onChange={setAttach} label="Include PDF" description={mode === "cloud" ? "Uploaded to WhatsApp and attached." : "On phones, shared as a file. On desktop, downloaded for you to attach."} />
                <a href={pdf} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
                  <FileText className="size-3.5" /> Preview PDF <ExternalLink className="size-3" />
                </a>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={send} loading={busy} disabled={!to.replace(/\D/g, "") || !text.trim()} className="bg-[#1f9d55] text-white hover:bg-[#188a49]">
                {mode === "cloud" ? <Send /> : attach && pdf ? <Share2 /> : <MessageCircle />}
                {mode === "cloud" ? "Send message" : "Open WhatsApp"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WhatsAppButton({ target, label = "WhatsApp", variant = "secondary" }: { target: Target; label?: string; variant?: "secondary" | "ghost" | "primary" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <MessageCircle /> {label}
      </Button>
      <WhatsAppDialog open={open} onOpenChange={setOpen} target={target} />
    </>
  );
}
