"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, CheckCircle2, LoaderCircle, MoreHorizontal, PackageCheck, Pencil } from "lucide-react";
import { closeOrderAction, receiveOrderAction } from "@/app/actions/orders";
import type { OrderDTO } from "@/lib/services/orders";
import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The buttons on an active order: "Received" (everything arrived), "Some products
 * missing?" (enter what actually came) and, for the owner, Edit / Close order.
 */
export function OrderActions({ order, role, className }: { order: OrderDTO; role: Role; className?: string }) {
  const [dialog, setDialog] = useState<"all" | "partial" | "close" | null>(null);
  if (order.status !== "ACTIVE") return null;

  const canReceive = can(role, "order.receive") && order.receivableLines > 0;
  const canManage = can(role, "order.manage");
  const canEdit = canManage && order.totalReceived === 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {canReceive ? (
        <>
          <Button size="lg" className="h-11" onClick={() => setDialog("all")}>
            <PackageCheck /> Received
          </Button>
          <Button size="lg" variant="outline" className="h-11" onClick={() => setDialog("partial")}>
            Some products missing?
          </Button>
        </>
      ) : null}
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-lg" variant="ghost" className="size-11" aria-label={`More actions for ${order.orderNumber}`} />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit ? (
              <DropdownMenuItem render={<Link href={`/orders/${order.id}/edit`} />}>
                <Pencil /> Edit order
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={() => setDialog("close")}>
              <Ban /> Close order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canReceive ? <ReceiveAllDialog order={order} open={dialog === "all"} onOpenChange={(o) => setDialog(o ? "all" : null)} /> : null}
      {canReceive ? <ReceivePartialDialog order={order} open={dialog === "partial"} onOpenChange={(o) => setDialog(o ? "partial" : null)} /> : null}
      {canManage ? <CloseOrderDialog order={order} open={dialog === "close"} onOpenChange={(o) => setDialog(o ? "close" : null)} /> : null}
    </div>
  );
}

function receivedToast(before: OrderDTO, after: OrderDTO) {
  const units = after.totalReceived - before.totalReceived;
  toast.success(`${plural(units, "unit")} added to stock`, {
    description: after.status === "RECEIVED" ? `${after.orderNumber} is fully received.` : `${after.orderNumber} is still waiting for ${plural(after.totalPending, "unit")}.`,
  });
}

function ReceiveAllDialog({ order, open, onOpenChange }: { order: OrderDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, start] = useTransition();
  const lines = order.items.filter((i) => i.pending > 0 && i.productId);

  const confirm = () =>
    start(async () => {
      const res = await receiveOrderAction({ orderId: order.id, lines: "ALL" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      receivedToast(order, res.data);
      onOpenChange(false);
    });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Did everything arrive?</AlertDialogTitle>
          <AlertDialogDescription>
            Stock goes up for {plural(lines.length, "product")} on {order.orderNumber}. If something is missing, use “Some products missing?” instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border text-sm">
          {lines.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{i.name}</span>
              <span className="shrink-0 font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">+{i.pending}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
            Yes, add to stock
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReceivePartialDialog({ order, open, onOpenChange }: { order: OrderDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">What arrived?</DialogTitle>
          <DialogDescription>
            Enter how many of each product came. Set 0 for anything that didn’t. The rest stays on {order.orderNumber} until it arrives.
          </DialogDescription>
        </DialogHeader>
        {open ? <PartialForm order={order} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PartialForm({ order, close }: { order: OrderDTO; close: () => void }) {
  const lines = order.items.filter((i) => i.pending > 0 && i.productId);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((i) => [i.id, String(i.pending)])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsed = lines.map((i) => ({ item: i, n: Number.parseInt(qty[i.id] || "0", 10) || 0 }));
  const over = parsed.find((p) => p.n > p.item.pending);
  const total = parsed.reduce((s, p) => s + p.n, 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (over) return setError(`Only ${over.item.pending} of “${over.item.name}” are pending.`);
    if (total === 0) return setError("Enter the quantity that arrived for at least one product.");
    start(async () => {
      const res = await receiveOrderAction({ orderId: order.id, lines: parsed.map((p) => ({ itemId: p.item.id, quantity: p.n })) });
      if (!res.ok) return setError(res.error);
      receivedToast(order, res.data);
      close();
    });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
      <ul className="-mx-1 min-h-0 flex-1 divide-y overflow-y-auto rounded-xl border">
        {parsed.map(({ item, n }) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.pending} pending{item.quantityReceived > 0 ? ` · ${item.quantityReceived} already received` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={item.pending}
                value={qty[item.id]}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setQty((q) => ({ ...q, [item.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                aria-label={`Quantity of ${item.name} that arrived`}
                aria-invalid={n > item.pending}
                className="h-11 w-20 text-center text-base font-semibold tabular-nums"
              />
              <span className="w-10 text-xs text-muted-foreground tabular-nums">/ {item.pending}</span>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={pending || total === 0 || Boolean(over)}>
          {pending ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
          Add {plural(total, "unit")} to stock
        </Button>
      </DialogFooter>
    </form>
  );
}

function CloseOrderDialog({ order, open, onOpenChange }: { order: OrderDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirm = () => {
    setError(null);
    start(async () => {
      const res = await closeOrderAction({ orderId: order.id, reason });
      if (!res.ok) {
        setError(res.fieldErrors?.reason ?? res.error);
        return;
      }
      toast.success(`${order.orderNumber} closed`, { description: "Stock was not changed." });
      onOpenChange(false);
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close {order.orderNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            {order.totalReceived === 0
              ? "Nothing has arrived on this order. Closing it stops waiting for it. Stock does not change."
              : `${plural(order.totalPending, "unit")} still pending will be marked as not received. Products already received stay in stock.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field label="Reason" htmlFor={`close-${order.id}`} required error={error ?? undefined}>
          <Input
            id={`close-${order.id}`}
            className="h-11"
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Not available at the shop"
            maxLength={300}
            aria-invalid={Boolean(error)}
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep waiting</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending || reason.trim().length < 3} variant="destructive">
            {pending ? <LoaderCircle className="animate-spin" /> : null}
            Close order
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
