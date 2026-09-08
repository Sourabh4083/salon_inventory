"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDownToLine, ClipboardCheck, LoaderCircle, Pencil, ShoppingBag, Trash2 } from "lucide-react";
import { archiveProductAction, deleteProductAction, restoreProductAction } from "@/app/actions/products";
import type { ProductDTO } from "@/lib/services/products";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStockDialogs } from "@/components/app/stock-dialogs";

export function ProductDetailActions({ product, role }: { product: ProductDTO; role: Role }) {
  const router = useRouter();
  const { openDialog, dialogs } = useStockDialogs();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, start] = useTransition();
  const canDelete = can(role, "product.delete");
  const archived = product.status === "ARCHIVED";

  const toggleArchive = () => {
    start(async () => {
      const res = archived ? await restoreProductAction(product.id) : await archiveProductAction(product.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(archived ? "Product restored" : "Product archived", {
        description: archived ? `${product.name} is active again.` : `${product.name} is hidden from inventory but keeps its history.`,
      });
      setConfirmOpen(false);
      router.refresh();
    });
  };

  const remove = () => {
    start(async () => {
      const res = await deleteProductAction(product.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Product deleted", { description: `${res.data.productNumber} "${res.data.name}" has been permanently removed.` });
      setDeleteOpen(false);
      router.push("/inventory");
      router.refresh();
    });
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button size="lg" className="h-12 text-base sm:h-11 sm:text-sm" onClick={() => openDialog("sale", product)} disabled={archived || product.quantity === 0}>
          <ShoppingBag /> Reduce stock (no bill)
        </Button>
        <Button size="lg" variant="secondary" className="h-12 text-base sm:h-11 sm:text-sm" onClick={() => openDialog("stockIn", product)} disabled={archived}>
          <ArrowDownToLine /> Add stock
        </Button>
        <Button size="lg" variant="outline" className="h-11" onClick={() => openDialog("adjust", product)} disabled={archived}>
          <ClipboardCheck /> Adjust stock
        </Button>
        {can(role, "product.edit") && (!archived || role === "OWNER") ? (
          <Button size="lg" variant="outline" className="h-11" render={<Link href={`/inventory/${product.id}/edit`} />}>
            <Pencil /> Edit product
          </Button>
        ) : null}
        {can(role, "product.archive") ? (
          <Button size="lg" variant="ghost" className="col-span-2 h-11 text-muted-foreground sm:ml-auto" onClick={() => setConfirmOpen(true)}>
            {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore" : "Archive"}
          </Button>
        ) : null}
        {canDelete ? (
          <Button size="lg" variant="ghost" className="col-span-2 h-11 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 /> Delete
          </Button>
        ) : null}
      </div>
      {dialogs}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{archived ? "Restore this product?" : "Archive this product?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {archived
                ? `${product.name} will appear in inventory again and can be sold or restocked.`
                : `${product.name} will be hidden from the inventory list and cannot be sold. Its stock history is kept and you can restore it later.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggleArchive} disabled={pending} variant={archived ? "default" : "destructive"}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {archived ? "Restore" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canDelete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this product permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                {`${product.name} (${product.productNumber}) and all of its stock history will be removed for good. This cannot be undone. If you only want to hide it, use Archive instead.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={remove} disabled={pending} variant="destructive">
                {pending ? <LoaderCircle className="animate-spin" /> : null}
                Delete permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
