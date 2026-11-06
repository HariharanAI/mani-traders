"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDownLeft, ArrowUpRight, Download, FileText, MessageCircle, MoreHorizontal, Pencil, Phone, Plus, Trash2, UserPlus, Wallet } from "lucide-react";
import { Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui";
import { CustomerDialog, KhataEntryDialog, PaymentDialog, type CustomerRecord } from "@/components/forms";
import { useShell } from "@/components/shell";
import { WhatsAppDialog } from "@/components/whatsapp";
import { useAction } from "@/components/hooks";
import { archiveCustomerAction, deleteCustomerAction } from "@/app/_actions/business";

export function AddCustomerButton({ categories }: { categories: string[] }) {
  const { can, staff } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!can("customers.manage")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus /> Add customer
      </Button>
      <CustomerDialog open={open} onOpenChange={setOpen} categories={categories} staff={staff} onSaved={(c) => router.push(`/customers/${c.id}`)} />
    </>
  );
}

export function CustomerActions({ customer, balance, categories, canDelete }: { customer: CustomerRecord & { code: string; archivedAt: Date | null }; balance: number; categories: string[]; canDelete: boolean }) {
  const { can, staff } = useShell();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "gave" | "got" | "edit" | "payment" | "wa">(null);
  const [waType, setWaType] = useState<"REMINDER" | "STATEMENT" | "MONTHLY_SUMMARY">("REMINDER");
  const archive = useAction(archiveCustomerAction);
  const del = useAction(deleteCustomerAction);
  const party = { type: "CUSTOMER" as const, id: customer.id, name: customer.name, balance };
  const phone = customer.whatsapp || customer.mobile;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {phone && can("messages.send") ? (
          <Button
            variant="secondary"
            onClick={() => {
              setWaType("REMINDER");
              setDialog("wa");
            }}
          >
            <MessageCircle /> Remind
          </Button>
        ) : null}
        <a href={`/api/pdf/statement/customer/${customer.id}`} target="_blank" rel="noreferrer">
          <Button variant="secondary">
            <FileText /> Statement
          </Button>
        </a>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {can("customers.manage") ? (
              <MenuItem onSelect={() => setDialog("edit")}>
                <Pencil /> Edit details
              </MenuItem>
            ) : null}
            {customer.mobile ? (
              <MenuItem onSelect={() => (window.location.href = `tel:${customer.mobile}`)}>
                <Phone /> Call {customer.mobile}
              </MenuItem>
            ) : null}
            <MenuItem onSelect={() => window.open(`/api/pdf/statement/customer/${customer.id}?download=1`)}>
              <Download /> Download statement PDF
            </MenuItem>
            {phone && can("messages.send") ? (
              <>
                <MenuItem
                  onSelect={() => {
                    setWaType("STATEMENT");
                    setDialog("wa");
                  }}
                >
                  <MessageCircle /> Send statement on WhatsApp
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    setWaType("MONTHLY_SUMMARY");
                    setDialog("wa");
                  }}
                >
                  <MessageCircle /> Send monthly summary
                </MenuItem>
              </>
            ) : null}
            {can("customers.archive") ? (
              <>
                <MenuSeparator />
                <MenuItem
                  onSelect={async () => {
                    if (!customer.archivedAt && balance !== 0 && !confirm(`${customer.name} still has a balance. Archive anyway? The history stays intact.`)) return;
                    const r = await archive.run(customer.id, !customer.archivedAt);
                    if (r.ok) {
                      toast.success(customer.archivedAt ? "Customer restored" : "Customer archived");
                      router.refresh();
                    }
                  }}
                >
                  {customer.archivedAt ? <ArchiveRestore /> : <Archive />} {customer.archivedAt ? "Restore customer" : "Archive customer"}
                </MenuItem>
                {canDelete ? (
                  <MenuItem
                    danger
                    onSelect={async () => {
                      if (!confirm(`Delete ${customer.name}? This is only possible because they have no transactions.`)) return;
                      const r = await del.run(customer.id);
                      if (r.ok) {
                        toast.success("Customer deleted");
                        router.push("/customers");
                      }
                    }}
                  >
                    <Trash2 /> Delete (no history)
                  </MenuItem>
                ) : null}
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
      {/* Sticky primary actions — thumb reachable on mobile */}
      {!customer.archivedAt ? (
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t border-border bg-surface/95 p-3 backdrop-blur lg:static lg:mt-0 lg:flex lg:border-0 lg:bg-transparent lg:p-0">
          {can("ledger.create") ? (
            <Button variant="get" size="lg" className="lg:h-10 lg:text-sm" onClick={() => setDialog("gave")}>
              <ArrowUpRight /> You gave
            </Button>
          ) : null}
          {can("payments.receive") ? (
            <Button variant="give" size="lg" className="lg:h-10 lg:text-sm" onClick={() => setDialog("got")}>
              <ArrowDownLeft /> You got
            </Button>
          ) : null}
          {can("payments.receive") ? (
            <Button variant="secondary" className="col-span-2 hidden lg:inline-flex" onClick={() => setDialog("payment")}>
              <Wallet /> Receive payment
            </Button>
          ) : null}
          {can("sales.create") ? (
            <Button variant="secondary" className="hidden lg:inline-flex" onClick={() => router.push(`/sales/new?customer=${customer.id}`)}>
              <Plus /> New sale
            </Button>
          ) : null}
        </div>
      ) : null}
      <KhataEntryDialog open={dialog === "gave" || dialog === "got"} onOpenChange={(o) => !o && setDialog(null)} party={party} initialKind={dialog === "got" ? "GOT_MONEY" : "GAVE_GOODS"} canAdjust={can("ledger.create")} />
      <PaymentDialog open={dialog === "payment"} onOpenChange={(o) => !o && setDialog(null)} direction="IN" party={{ type: "CUSTOMER", option: { id: customer.id, name: customer.name, mobile: customer.mobile, balance, code: customer.code } }} />
      <CustomerDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} customer={customer} categories={categories} staff={staff} />
      <WhatsAppDialog open={dialog === "wa"} onOpenChange={(o) => !o && setDialog(null)} target={{ kind: "party", type: waType, partyType: "CUSTOMER", partyId: customer.id }} />
    </>
  );
}
