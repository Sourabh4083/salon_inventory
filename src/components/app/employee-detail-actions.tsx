"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LoaderCircle, Pencil, UserCheck, UserX } from "lucide-react";
import { setEmployeeActiveAction } from "@/app/actions/employees";
import type { EmployeeDTO } from "@/lib/services/employees";
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

export function EmployeeDetailActions({ employee }: { employee: EmployeeDTO }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();
  const active = employee.isActive;

  const toggle = () => {
    start(async () => {
      const res = await setEmployeeActiveAction(employee.id, !active);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(active ? "Employee marked as left" : "Employee reactivated", { description: employee.name });
      setConfirmOpen(false);
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" variant="outline" className="h-11" render={<Link href={`/employees/${employee.id}/edit`} />}>
          <Pencil /> Edit details
        </Button>
        <Button size="lg" variant={active ? "ghost" : "secondary"} className="h-11" onClick={() => setConfirmOpen(true)}>
          {active ? <UserX /> : <UserCheck />} {active ? "Mark as left" : "Reactivate"}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{active ? "Mark this employee as left?" : "Reactivate this employee?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {active
                ? `${employee.name} will be moved to the inactive list and today's date is saved as the leaving date. Documents and salary history are kept.`
                : `${employee.name} will appear in the active staff list again and the leaving date will be cleared.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggle} disabled={pending} variant={active ? "destructive" : "default"}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {active ? "Mark as left" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
