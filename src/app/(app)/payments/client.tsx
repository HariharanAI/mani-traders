"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { PaymentDialog, ReasonDialog } from "@/components/forms";
import { WhatsAppButton } from "@/components/whatsapp";
import { useShell } from "@/components/shell";
import { reversePaymentAction } from "@/app/_actions/business";

export function PaymentButtons() {
  const { can } = useShell();
  const [open, setOpen] = useState<null | "IN" | "OUT">(null);
  return (
    <>
      <div className="flex gap-2">
        {can("payments.receive") ? (
          <Button variant="give" onClick={() => setOpen("IN")}>
            <ArrowDownLeft /> Receive
          </Button>
        ) : null}
        {can("payments.make") ? (
          <Button variant="secondary" onClick={() => setOpen("OUT")}>
            <ArrowUpRight /> Make payment
          </Button>
        ) : null}
      </div>
      <PaymentDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} direction={open ?? "IN"} canMake={can("payments.make")} canReceive={can("payments.receive")} />
    </>
  );
}

export function PaymentDetailActions({ id, paymentNo, active, reversible, hasParty }: { id: string; paymentNo: string; active: boolean; reversible: boolean; hasParty: boolean }) {
  const { can } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {hasParty && can("messages.send") ? <WhatsAppButton target={{ kind: "receipt", paymentId: id }} label="Send receipt" /> : null}
        <a href={`/api/pdf/receipt/${id}?download=1`}>
          <Button variant="secondary">
            <Download /> PDF
          </Button>
        </a>
        {active && reversible && can("payments.reverse") ? (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <RotateCcw /> Reverse
          </Button>
        ) : null}
      </div>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Reverse payment ${paymentNo}?`}
        description="Use this for bounced cheques or wrong entries. The balance is restored with a correcting entry; nothing is deleted."
        confirmLabel="Reverse payment"
        onConfirm={async (reason) => {
          const r = await reversePaymentAction(id, reason);
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success("Payment reversed");
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
