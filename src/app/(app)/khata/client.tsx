"use client";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button, Dialog, DialogContent, Field } from "@/components/ui";
import { KhataEntryDialog, PartyPicker } from "@/components/forms";
import { useShell } from "@/components/shell";

/** Pick a customer, then add "You gave" / "You got" — the two most common daily actions. */
export function QuickKhataEntry() {
  const { can } = useShell();
  const [pick, setPick] = useState<null | "GAVE_GOODS" | "GOT_MONEY">(null);
  const [party, setParty] = useState<{ id: string; name: string; mobile: string | null; balance: number; code: string } | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const kind = pick;
  return (
    <>
      <div className="flex gap-2">
        {can("ledger.create") ? (
          <Button variant="get" onClick={() => (setParty(null), setPick("GAVE_GOODS"))}>
            <ArrowUpRight /> You gave
          </Button>
        ) : null}
        {can("payments.receive") ? (
          <Button variant="give" onClick={() => (setParty(null), setPick("GOT_MONEY"))}>
            <ArrowDownLeft /> You got
          </Button>
        ) : null}
      </div>
      <Dialog open={!!pick && !entryOpen} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent title={kind === "GOT_MONEY" ? "You got — select customer" : "You gave — select customer"}>
          <Field label="Customer">
            <PartyPicker
              type="CUSTOMER"
              autoFocus
              value={party}
              onChange={(p) => {
                setParty(p);
                if (p) setEntryOpen(true);
              }}
            />
          </Field>
        </DialogContent>
      </Dialog>
      {party ? (
        <KhataEntryDialog
          open={entryOpen}
          onOpenChange={(o) => {
            setEntryOpen(o);
            if (!o) setPick(null);
          }}
          party={{ type: "CUSTOMER", id: party.id, name: party.name, balance: party.balance }}
          initialKind={kind ?? "GAVE_GOODS"}
          canAdjust={can("ledger.create")}
        />
      ) : null}
    </>
  );
}
