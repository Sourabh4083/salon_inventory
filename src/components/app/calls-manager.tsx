"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck, CheckCheck, ChevronDown, ChevronUp, LoaderCircle, MessageCircle, Pencil, Phone, PhoneCall, PhoneMissed, PhoneOff, Plus, Store } from "lucide-react";
import { addNumbersAction, logCallAction, markVisitedAction, updateEnquiryAction } from "@/app/actions/enquiries";
import type { EnquiryDTO } from "@/lib/services/enquiries";
import type { CallResult, EnquiryStatus } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { toDateParam } from "@/lib/dates";
import { addDaysInZone, startOfDayInZone } from "@/lib/timezone";
import { telLink, whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/field";
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

/* ---------- Labels ---------- */

const STATUS_CHIP: Record<EnquiryStatus, { text: string; className: string }> = {
  NEW: { text: "New", className: "bg-sky-100 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300" },
  NO_ANSWER: { text: "No answer", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" },
  CALL_BACK: { text: "Call back", className: "bg-violet-100 text-violet-800 dark:bg-violet-500/10 dark:text-violet-300" },
  COMING: { text: "Coming", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" },
  VISITED: { text: "Visited", className: "bg-emerald-600 text-white dark:bg-emerald-500/30 dark:text-emerald-100" },
  NOT_INTERESTED: { text: "Not interested", className: "bg-muted text-muted-foreground" },
};

const RESULT_TEXT: Record<CallResult, string> = {
  COMING: "Coming",
  CALL_BACK: "Call back later",
  NO_ANSWER: "No answer",
  NOT_INTERESTED: "Not interested",
};

function StatusChip({ status }: { status: EnquiryStatus }) {
  const s = STATUS_CHIP[status];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase", s.className)}>{s.text}</span>;
}

/** "Today", "Tomorrow", "Yesterday" or "02 Oct 2026". */
function dayLabel(iso: string, now = new Date()) {
  const day = startOfDayInZone(new Date(iso)).getTime();
  const today = startOfDayInZone(now);
  if (day === today.getTime()) return "Today";
  if (day === addDaysInZone(today, 1).getTime()) return "Tomorrow";
  if (day === addDaysInZone(today, -1).getTime()) return "Yesterday";
  return formatDate(iso);
}

function isPast(iso: string | null) {
  return iso !== null && new Date(iso) < startOfDayInZone(new Date());
}

/** One line saying where this enquiry stands. */
function statusLine(e: EnquiryDTO): { text: string; late?: boolean } {
  const tries = e.calls.length;
  switch (e.status) {
    case "NEW":
      return { text: `Added ${dayLabel(e.createdAt).toLowerCase() === "today" ? "today" : formatDate(e.createdAt)} by ${e.createdByName} · not called yet` };
    case "NO_ANSWER":
      return { text: `No answer${tries > 1 ? ` (${tries} tries)` : ""} · try again ${dayLabel(e.nextCallOn!).toLowerCase()}`, late: isPast(e.nextCallOn) };
    case "CALL_BACK":
      return { text: `Asked to call back ${dayLabel(e.nextCallOn!).toLowerCase()}`, late: isPast(e.nextCallOn) };
    case "COMING":
      return isPast(e.comingOn) ? { text: `Said they would come ${dayLabel(e.comingOn!).toLowerCase()} but did not visit`, late: true } : { text: `Coming ${dayLabel(e.comingOn!).toLowerCase()}` };
    case "VISITED":
      return { text: `Visited ${e.visitedAt ? formatDate(e.visitedAt) : ""} · ${e.visitedBillNumber ?? "marked by hand"}` };
    case "NOT_INTERESTED":
      return { text: `Not interested${e.calls[0] ? ` · ${formatDate(e.calls[0].calledAt)}` : ""}` };
  }
}

function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

/* ---------- Add numbers ---------- */

/** Box at the top of the Calls page: type or paste one or many mobile numbers. */
export function AddNumbersBox() {
  const id = useId();
  const [numbers, setNumbers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ duplicates: string[]; invalid: string[] } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSkipped(null);
    start(async () => {
      const res = await addNumbersAction({ numbers });
      if (!res.ok) {
        setError(res.fieldErrors?.numbers ?? res.error);
        return;
      }
      const { added, duplicates, invalid } = res.data;
      if (added) toast.success(`${added} number${added === 1 ? "" : "s"} added to the call list`);
      else toast.info("No new numbers added");
      setSkipped(duplicates.length || invalid.length ? { duplicates, invalid } : null);
      setNumbers(invalid.join("\n"));
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-card p-4 shadow-xs sm:p-5">
      <h2 className="flex items-center gap-2 font-heading text-lg">
        <PhoneCall className="size-4.5 text-primary" /> Add numbers to call
      </h2>
      <Field label="Mobile numbers" htmlFor={id} hint="Paste the numbers from WhatsApp or JustDial, or type the number of someone who phoned. One per line is fine; several at once works too.">
        <Textarea
          id={id}
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          placeholder={"98765 43210\n+91 91234 56789"}
          rows={3}
          className="min-h-20 text-base"
          inputMode="tel"
          aria-invalid={Boolean(error)}
        />
      </Field>
      <ErrorBox error={error} />
      {skipped ? (
        <div className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          {skipped.duplicates.length ? (
            <p>
              <span className="font-medium">Already in the list:</span> {skipped.duplicates.join(", ")}
            </p>
          ) : null}
          {skipped.invalid.length ? (
            <p className="text-destructive">
              <span className="font-medium">Not a valid number (left in the box to fix):</span> {skipped.invalid.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" size="lg" className="h-11 w-full sm:w-auto" disabled={pending || !numbers.trim()}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add to call list
      </Button>
    </form>
  );
}

/* ---------- List ---------- */

export function EnquiryList({ enquiries, emptyText }: { enquiries: EnquiryDTO[]; emptyText: string }) {
  const [logging, setLogging] = useState<EnquiryDTO | null>(null);
  const [editing, setEditing] = useState<EnquiryDTO | null>(null);
  const [visiting, setVisiting] = useState<EnquiryDTO | null>(null);
  const [marking, startMarking] = useTransition();

  const markVisited = () => {
    if (!visiting) return;
    const e = visiting;
    startMarking(async () => {
      const res = await markVisitedAction(e.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Marked as visited", { description: e.name ?? e.phone });
      setVisiting(null);
    });
  };

  if (enquiries.length === 0) {
    return <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <ul className="divide-y rounded-2xl border bg-card shadow-xs">
        {enquiries.map((e) => (
          <EnquiryRow key={e.id} enquiry={e} onLog={() => setLogging(e)} onEdit={() => setEditing(e)} onVisited={() => setVisiting(e)} />
        ))}
      </ul>

      <Dialog open={logging !== null} onOpenChange={(o) => !o && setLogging(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Log call · {logging?.name ?? logging?.phone}</DialogTitle>
          </DialogHeader>
          {logging ? <LogCallForm enquiry={logging} close={() => setLogging(null)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">Edit details</DialogTitle>
          </DialogHeader>
          {editing ? <EditEnquiryForm enquiry={editing} close={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={visiting !== null} onOpenChange={(o) => !o && setVisiting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Did {visiting?.name ?? visiting?.phone} come to the salon?</AlertDialogTitle>
            <AlertDialogDescription>
              They move to Closed as visited and drop off the call list. (When their bill has this mobile number, this happens by itself.)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={marking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={markVisited} disabled={marking}>
              {marking ? <LoaderCircle className="animate-spin" /> : null} Yes, they came
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EnquiryRow({ enquiry: e, onLog, onEdit, onVisited }: { enquiry: EnquiryDTO; onLog: () => void; onEdit: () => void; onVisited: () => void }) {
  const [open, setOpen] = useState(false);
  const isOpen = e.status !== "VISITED" && e.status !== "NOT_INTERESTED";
  const line = statusLine(e);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <a href={telLink(e.phone)} className="text-base font-semibold hover:underline">
              {e.name ?? e.phone}
            </a>
            <StatusChip status={e.status} />
          </p>
          {e.name ? (
            <a href={telLink(e.phone)} className="block text-sm text-muted-foreground tabular-nums hover:underline">
              {e.phone}
            </a>
          ) : null}
          {e.interest ? <p className="text-sm">Asked about: {e.interest}</p> : null}
          <p className={cn("text-xs", line.late ? "font-medium text-destructive" : "text-muted-foreground")}>{line.text}</p>
          {e.calls[0]?.note ? <p className="text-xs text-muted-foreground italic">“{e.calls[0].note}”</p> : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isOpen ? (
            <>
              <Button size="lg" variant="outline" className="h-11" render={<a href={telLink(e.phone)} />}>
                <Phone /> Call
              </Button>
              <Button size="lg" className="h-11" onClick={onLog}>
                <CalendarCheck /> Log call
              </Button>
              <Button size="lg" variant="outline" className="h-11 text-emerald-700 dark:text-emerald-400" onClick={onVisited}>
                <CheckCheck /> Visited
              </Button>
            </>
          ) : null}
          <Button size="icon-lg" variant="ghost" className="size-11 text-emerald-700 dark:text-emerald-400" render={<a href={whatsappLink(e.phone)} target="_blank" rel="noreferrer" />} aria-label="Open in WhatsApp">
            <MessageCircle />
          </Button>
          <Button size="icon-lg" variant="ghost" className="size-11 text-muted-foreground" onClick={onEdit} aria-label="Edit details">
            <Pencil />
          </Button>
        </div>
      </div>

      {e.calls.length ? (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" aria-expanded={open}>
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} Call history ({e.calls.length})
          </button>
          {open ? (
            <ol className="mt-2 space-y-1.5 border-l-2 pl-3 text-xs">
              {e.calls.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{RESULT_TEXT[c.result]}</span>
                  {c.followUpOn && c.result !== "NOT_INTERESTED" ? <span> · {formatDate(c.followUpOn)}</span> : null}
                  <span className="text-muted-foreground">
                    {" "}
                    — {formatDateTime(c.calledAt)} by {c.calledByName}
                  </span>
                  {c.note ? <p className="text-muted-foreground italic">“{c.note}”</p> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ---------- Log call ---------- */

const RESULT_OPTIONS: { value: CallResult; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "COMING", label: "Coming", hint: "Pick the day", icon: Store },
  { value: "CALL_BACK", label: "Call back later", hint: "Pick when", icon: CalendarCheck },
  { value: "NO_ANSWER", label: "No answer", hint: "Try again tomorrow", icon: PhoneMissed },
  { value: "NOT_INTERESTED", label: "Not interested", hint: "Close it", icon: PhoneOff },
];

function LogCallForm({ enquiry, close }: { enquiry: EnquiryDTO; close: () => void }) {
  const id = useId();
  const today = toDateParam(new Date());
  const [result, setResult] = useState<CallResult | null>(null);
  const [date, setDate] = useState(today);
  const [name, setName] = useState(enquiry.name ?? "");
  const [interest, setInterest] = useState(enquiry.interest ?? "");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsDate = result === "COMING" || result === "CALL_BACK";

  const pick = (r: CallResult) => {
    setResult(r);
    // Coming usually means today; a call-back usually means tomorrow.
    if (r === "CALL_BACK" && date === today) setDate(toDateParam(addDaysInZone(startOfDayInZone(new Date()), 1)));
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!result) {
      setErrors({ result: "Pick what the customer said." });
      return;
    }
    setErrors({});
    setError(null);
    start(async () => {
      const res = await logCallAction({ enquiryId: enquiry.id, result, date: needsDate ? date : undefined, note, name, interest });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success(`Saved: ${RESULT_TEXT[result]}`, { description: res.data.name ?? res.data.phone });
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          What did they say? <span className="text-destructive">*</span>
        </p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Call result">
          {RESULT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={result === o.value}
              onClick={() => pick(o.value)}
              className={cn(
                "flex min-h-16 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors",
                result === o.value ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <o.icon className="size-4" /> {o.label}
              </span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
        {errors.result ? <p className="text-xs text-destructive" role="alert">{errors.result}</p> : null}
      </div>

      {needsDate ? (
        <Field label={result === "COMING" ? "Coming on" : "Call again on"} htmlFor={`${id}-date`} required error={errors.date}>
          <Input id={`${id}-date`} type="date" className="h-11" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${id}-name`} error={errors.name}>
          <Input id={`${id}-name`} className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="If they told you" maxLength={120} />
        </Field>
        <Field label="Asked about" htmlFor={`${id}-interest`} error={errors.interest}>
          <Input id={`${id}-interest`} className="h-11" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="e.g. Hair colour, bridal" maxLength={200} />
        </Field>
      </div>
      <Field label="Note" htmlFor={`${id}-note`} error={errors.note}>
        <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="Anything to remember for next time" />
      </Field>

      <ErrorBox error={error} />
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null} Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ---------- Edit ---------- */

function EditEnquiryForm({ enquiry, close }: { enquiry: EnquiryDTO; close: () => void }) {
  const id = useId();
  const [values, setValues] = useState({ name: enquiry.name ?? "", phone: enquiry.phone, interest: enquiry.interest ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setErrors({});
    setError(null);
    start(async () => {
      const res = await updateEnquiryAction(enquiry.id, values);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      toast.success("Details saved");
      close();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Mobile number" htmlFor={`${id}-phone`} required error={errors.phone}>
        <Input id={`${id}-phone`} className="h-11 text-base" inputMode="tel" value={values.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={25} />
      </Field>
      <Field label="Name" htmlFor={`${id}-name`} error={errors.name}>
        <Input id={`${id}-name`} className="h-11" value={values.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
      </Field>
      <Field label="Asked about" htmlFor={`${id}-interest`} error={errors.interest}>
        <Input id={`${id}-interest`} className="h-11" value={values.interest} onChange={(e) => set({ interest: e.target.value })} maxLength={200} />
      </Field>
      <ErrorBox error={error} />
      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : null} Save
        </Button>
      </DialogFooter>
    </form>
  );
}
