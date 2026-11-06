"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, PackagePlus, Pencil, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui";
import { ProductDialog, StockAdjustDialog, type ProductRecord } from "@/components/forms";
import { useShell } from "@/components/shell";
import { useAction } from "@/components/hooks";
import { archiveProductAction } from "@/app/_actions/business";

export function AddProductButton() {
  const { can, categories, gstEnabled } = useShell();
  const [open, setOpen] = useState(false);
  if (!can("inventory.manage")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PackagePlus /> Add product
      </Button>
      <ProductDialog open={open} onOpenChange={setOpen} categories={categories} gstEnabled={gstEnabled} />
    </>
  );
}

export function ProductActions({ product, stock, avgCost, archived }: { product: ProductRecord; stock: string; avgCost: string; archived: boolean }) {
  const { can, categories, gstEnabled } = useShell();
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "edit" | "adjust">(null);
  const archive = useAction(archiveProductAction);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {can("inventory.adjust") && !archived ? (
          <Button onClick={() => setDialog("adjust")}>
            <SlidersHorizontal /> Adjust stock
          </Button>
        ) : null}
        {can("inventory.manage") ? (
          <>
            <Button variant="secondary" onClick={() => setDialog("edit")}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const r = await archive.run(product.id, !archived);
                if (r.ok) {
                  toast.success(archived ? "Product restored" : "Product archived — hidden from billing, history kept");
                  router.refresh();
                }
              }}
            >
              {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
            </Button>
          </>
        ) : null}
      </div>
      <ProductDialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} product={product} categories={categories} gstEnabled={gstEnabled} />
      <StockAdjustDialog open={dialog === "adjust"} onOpenChange={(o) => !o && setDialog(null)} product={{ id: product.id, name: product.name, unit: product.unit, stock, avgCost }} />
    </>
  );
}
