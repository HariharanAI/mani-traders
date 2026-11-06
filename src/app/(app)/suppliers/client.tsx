"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDownLeft, ArrowUpRight, FileText, MoreHorizontal, Pencil, Plus, ShoppingBag } from "lucide-react";
import { Button, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { KhataEntryDialog, SupplierDialog, type SupplierRecord } from "@/components/forms";
import { useShell } from "@/components/shell";
import { useAction } from "@/components/hooks";
import { archiveSupplierAction } from "@/app/_actions/business";

export function AddSupplierButton() {
  const { can } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!can("suppliers.manage")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Add supplier
      </Button>
      <SupplierDialog open={open} onOpenChange={setOpen} onSaved={(s) => router.push(`/suppliers/${s.id}`)} />
    </>
  );
}

export function SupplierActions({ supplier, balance }: { supplier: SupplierRecord & { archivedAt: Date | null }; balance: number }) {
  const { can } = useShell();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "gave" | "got" | "edit">(null);
  const archive = useAction(archiveSupplierAction);
  const party = { type: "SUPPLIER" as const, id: supplier.id, name: supplier.name, balance };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {can("purchases.create") && !supplier.archivedAt ? (
          <Button onClick={() => router.push(`/purchases/new?supplier=${supplier.id}`)}>
            <ShoppingBag /> New purchase
          </Button>
        ) : null}
        {can("payments.make") && !supplier.archivedAt ? (
          <Button variant="give" onClick={() => setDialog("gave")}>
            <ArrowUpRight /> Pay supplier
          </Button>
        ) : null}
        <a href={`/api/pdf/statement/supplier/${supplier.id}`} target="_blank" rel="noreferrer">
          <Button variant="secondary">
            <FileText /> Statement
          </Button>
        </a>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="More">
              <MoreHorizontal />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {can("ledger.create") ? (
              <MenuItem onSelect={() => setDialog("got")}>
                <ArrowDownLeft /> Add bill / other entry
              </MenuItem>
            ) : null}
            {can("suppliers.manage") ? (
              <>
                <MenuItem onSelect={() => setDialog("edit")}>
                  <Pencil /> Edit details
                </MenuItem>
                <MenuItem
                  onSelect={async () => {
                    const r = await archive.run(supplier.id, !supplier.archivedAt);
                    if (r.ok) {
                      toast.success(supplier.archivedAt ? "Supplier restored" : "Supplier archived");
                      router.refresh();
                    }
                  }}
                >
                  {supplier.archivedAt ? <ArchiveRestore /> : <Archive />} {supplier.archivedAt ? "Restore" : "Archive"}
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
      <KhataEntryDialog open={dialog === "gave" || dialog === "got"} onOpenChange={(o) => !o && setDialog(null)} party={party} initialKind={dialog === "gave" ? "GAVE_MONEY" : "GOT_GOODS"} canAdjust={can("ledger.create")} />
      <SupplierDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} supplier={supplier} />
    </>
  );
}
