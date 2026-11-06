"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Wallet } from "lucide-react";
import { Button, Switch } from "@/components/ui";
import { PaymentDialog, ReasonDialog } from "@/components/forms";
import { useShell } from "@/components/shell";
import { cancelPurchaseAction } from "@/app/_actions/business";

export function PurchaseActions({ purchase }: { purchase: { id: string; purchaseNo: string; status: string; supplierId: string; supplierName: string; due: number; paidCount: number } }) {
  const { can } = useShell();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "cancel" | "pay">(null);
  const [reversePayments, setReversePayments] = useState(true);
  if (purchase.status !== "ACTIVE") return null;
  return (
    <>
      <div className="flex gap-2">
        {purchase.due > 0 && can("payments.make") ? (
          <Button variant="give" onClick={() => setDialog("pay")}>
            <Wallet /> Pay supplier
          </Button>
        ) : null}
        {can("purchases.cancel") ? (
          <Button variant="secondary" onClick={() => setDialog("cancel")}>
            <Ban /> Cancel purchase
          </Button>
        ) : null}
      </div>
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel ${purchase.purchaseNo}?`}
        description="Stock is removed and the supplier balance is reversed. Not possible if the stock has already been sold."
        confirmLabel="Cancel purchase"
        extra={purchase.paidCount ? <Switch checked={reversePayments} onChange={setReversePayments} label="Also reverse payments made" description="Turn off if the supplier keeps the money as an advance." /> : null}
        onConfirm={async (reason) => {
          const r = await cancelPurchaseAction({ id: purchase.id, reason, reversePayments });
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          toast.success("Purchase cancelled");
          router.refresh();
          return true;
        }}
      />
      <PaymentDialog open={dialog === "pay"} onOpenChange={(o) => !o && setDialog(null)} direction="OUT" party={{ type: "SUPPLIER", option: { id: purchase.supplierId, name: purchase.supplierName, mobile: null, balance: purchase.due, code: "" } }} />
    </>
  );
}
