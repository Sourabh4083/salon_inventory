"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, LoaderCircle, Pencil, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { createManagerAction, resetManagerPasswordAction, updateManagerAction } from "@/app/actions/users";
import type { UserDTO } from "@/lib/services/users";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
import { cn } from "@/lib/utils";

type Mode = { kind: "create" } | { kind: "edit"; user: UserDTO } | { kind: "password"; user: UserDTO } | null;

export function UsersManager({ users, currentUserId }: { users: UserDTO[]; currentUserId: string }) {
  const [mode, setMode] = useState<Mode>(null);
  const owners = users.filter((u) => u.role === "OWNER");
  const managers = users.filter((u) => u.role === "MANAGER");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-heading text-lg">Owner</h2>
        <ul className="divide-y rounded-2xl border bg-card shadow-xs">
          {owners.map((u) => (
            <UserRow key={u.id} user={u} isMe={u.id === currentUserId} onPassword={() => setMode({ kind: "password", user: u })} />
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg">Managers</h2>
          <Button size="lg" className="h-11" onClick={() => setMode({ kind: "create" })}>
            <UserPlus /> Add Manager
          </Button>
        </div>
        {managers.length ? (
          <ul className="divide-y rounded-2xl border bg-card shadow-xs">
            {managers.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={false}
                onEdit={() => setMode({ kind: "edit", user: u })}
                onPassword={() => setMode({ kind: "password", user: u })}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No manager accounts yet.</p>
        )}
      </section>

      <CreateManagerDialog open={mode?.kind === "create"} onOpenChange={(o) => !o && setMode(null)} />
      <EditManagerDialog user={mode?.kind === "edit" ? mode.user : null} onOpenChange={(o) => !o && setMode(null)} />
      <PasswordDialog user={mode?.kind === "password" ? mode.user : null} onOpenChange={(o) => !o && setMode(null)} />
    </div>
  );
}

function UserRow({ user, isMe, onEdit, onPassword }: { user: UserDTO; isMe: boolean; onEdit?: () => void; onPassword: () => void }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          user.role === "OWNER" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
        )}
      >
        {user.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {user.name}
          {isMe ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">You</span> : null}
          {!user.isActive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-300 uppercase">
              <UserX className="size-3" /> Disabled
            </span>
          ) : user.role === "OWNER" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase">
              <ShieldCheck className="size-3" /> Owner
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {user.email} · added {formatDate(user.createdAt)}
        </p>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        {onEdit ? (
          <Button variant="outline" size="lg" className="h-10 flex-1 sm:flex-none" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
        <Button variant="outline" size="lg" className="h-10 flex-1 sm:flex-none" onClick={onPassword}>
          <KeyRound /> {isMe ? "Change password" : "Reset password"}
        </Button>
      </div>
    </li>
  );
}

function CreateManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const reset = () => {
    setValues({ name: "", email: "", password: "" });
    setErrors({});
    setFormError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createManagerAction(values);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Manager account created", { description: `${res.data.name} can now sign in.` });
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Add manager</DialogTitle>
          <DialogDescription>Managers can add products, sell, receive stock and view history.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" htmlFor="m-name" required error={errors.name}>
            <Input id="m-name" className="h-11" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} autoFocus aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Email" htmlFor="m-email" required error={errors.email}>
            <Input id="m-email" type="email" className="h-11" inputMode="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} aria-invalid={Boolean(errors.email)} />
          </Field>
          <Field label="Temporary password" htmlFor="m-password" required error={errors.password} hint="At least 8 characters. Share it with the manager securely.">
            <Input id="m-password" type="text" className="h-11 font-mono" autoComplete="new-password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} aria-invalid={Boolean(errors.password)} />
          </Field>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="lg" className="h-11" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <UserPlus />} Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditManagerDialog({ user, onOpenChange }: { user: UserDTO | null; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(user?.name ?? "");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [key, setKey] = useState(user?.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (user && key !== user.id) {
    setKey(user.id);
    setName(user.name);
    setIsActive(user.isActive);
    setErrors({});
    setFormError(null);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    start(async () => {
      const res = await updateManagerAction({ userId: user.id, name, isActive });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Manager updated", { description: res.data.isActive ? `${res.data.name} is active.` : `${res.data.name} is disabled and cannot sign in.` });
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Edit manager</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" htmlFor="e-name" required error={errors.name}>
            <Input id="e-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(errors.name)} />
          </Field>
          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Account active</p>
              <p className="text-xs text-muted-foreground">Disabled managers are signed out immediately and cannot log in.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Account active" />
          </div>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="lg" className="h-11" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null} Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onOpenChange }: { user: UserDTO | null; onOpenChange: (o: boolean) => void }) {
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    start(async () => {
      const res = await resetManagerPasswordAction({ userId: user.id, password });
      if (!res.ok) return setError(res.fieldErrors?.password ?? res.error);
      toast.success("Password updated", { description: `${user.name} must use the new password from now on.` });
      setPassword("");
      setError(null);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={user !== null} onOpenChange={(o) => { if (!o) { setPassword(""); setError(null); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">Set a new password</DialogTitle>
          <DialogDescription>{user ? `${user.name} · ${user.email}` : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" htmlFor="p-password" required error={error ?? undefined} hint="At least 8 characters.">
            <Input id="p-password" type="text" className="h-11 font-mono" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus aria-invalid={Boolean(error)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="lg" className="h-11" disabled={pending || password.length < 8}>
              {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />} Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
