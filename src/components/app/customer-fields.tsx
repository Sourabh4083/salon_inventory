"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { History, LoaderCircle, UserRound } from "lucide-react";
import { customerHistoryAction, searchCustomersAction } from "@/app/actions/billing";
import type { CustomerHistoryDTO, CustomerSuggestionDTO } from "@/lib/services/customers";
import { formatDate, formatMoney } from "@/lib/format";
import { phoneKey } from "@/lib/phone";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/field";

/**
 * Customer name and phone on a bill. Typing either suggests past customers (name + number);
 * picking one fills both. Once the phone matches a past customer, their visits and recent
 * bills are shown underneath.
 */
export function CustomerFields({
  name,
  phone,
  onNameChange,
  onPhoneChange,
  errors,
  required,
  currencySymbol,
}: {
  name: string;
  phone: string;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  errors: Record<string, string>;
  required: boolean;
  currencySymbol: string;
}) {
  const [suggestions, setSuggestions] = useState<CustomerSuggestionDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [history, setHistory] = useState<CustomerHistoryDTO | null>(null);
  const key = phoneKey(phone);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Load the history of whoever the phone number belongs to, picked or typed.
  useEffect(() => {
    if (!key) return;
    let stale = false;
    const t = setTimeout(async () => {
      const res = await customerHistoryAction(key);
      if (!stale) setHistory(res.ok ? res.data : null);
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [key]);

  const search = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    if (value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const res = await searchCustomersAction(value);
      if (seq.current !== id) return;
      setSuggestions(res.ok ? res.data : []);
      setActive(0);
      setOpen(true);
      setLoading(false);
    }, 180);
  };

  const close = () => {
    ++seq.current;
    setOpen(false);
    setLoading(false);
  };

  const pick = (c: CustomerSuggestionDTO) => {
    onNameChange(c.name ?? name);
    onPhoneChange(c.phone);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  const shown = key && history?.phoneKey === key && history.visits > 0 ? history : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer name" htmlFor="bill-customer" error={errors.customerName}>
            <Input
              id="bill-customer"
              className="h-11"
              value={name}
              onChange={(e) => {
                onNameChange(e.target.value);
                search(e.target.value);
              }}
              onKeyDown={onKeyDown}
              onBlur={close}
              placeholder={required ? "Required" : "Optional"}
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(errors.customerName)}
            />
          </Field>
          <Field label="Phone" htmlFor="bill-phone" error={errors.customerPhone}>
            <div className="relative">
              <Input
                id="bill-phone"
                className="h-11"
                inputMode="tel"
                value={phone}
                onChange={(e) => {
                  onPhoneChange(e.target.value);
                  search(e.target.value.replace(/\D/g, "").length >= 3 ? e.target.value : "");
                }}
                onKeyDown={onKeyDown}
                onBlur={close}
                placeholder={required ? "Required" : "Optional"}
                maxLength={20}
                autoComplete="off"
                aria-invalid={Boolean(errors.customerPhone)}
              />
              {loading ? <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
            </div>
          </Field>
        </div>

        {open && suggestions.length ? (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 divide-y overflow-y-auto rounded-xl border bg-popover shadow-lg" role="listbox">
            {suggestions.map((c, i) => (
              <li key={c.phoneKey}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the input so blur doesn't close the list before the click lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${i === active ? "bg-accent" : ""}`}
                >
                  <UserRound className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name || "No name"}</p>
                    <p className="truncate text-xs text-muted-foreground tabular-nums">{c.phone}</p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-muted-foreground">
                    {c.visits} {c.visits === 1 ? "visit" : "visits"}
                    <span className="block">last {formatDate(c.lastVisit)}</span>
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {shown ? (
        <div className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <History className="size-4 text-muted-foreground" />
            Visited {shown.visits} {shown.visits === 1 ? "time" : "times"}
            {shown.lastVisit ? <span className="font-normal text-muted-foreground">· last on {formatDate(shown.lastVisit)}</span> : null}
          </p>
          {Number(shown.owes) > 0 ? <p className="mt-1 text-xs font-medium text-destructive">Still owes {formatMoney(shown.owes, currencySymbol)} from earlier bills</p> : null}
          <ul className="mt-2 space-y-1.5">
            {shown.bills.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3">
                <Link href={`/billing/${b.id}`} target="_blank" className="min-w-0 hover:underline">
                  <span className="font-medium">{b.billNumber}</span>
                  <span className="text-muted-foreground"> · {formatDate(b.createdAt)}</span>
                  {b.items.length ? <span className="block truncate text-xs text-muted-foreground">{b.items.join(", ")}</span> : null}
                </Link>
                <span className="shrink-0 tabular-nums">{formatMoney(b.total, currencySymbol)}</span>
              </li>
            ))}
          </ul>
          {shown.visits > shown.bills.length ? (
            <Link href={`/billing?q=${encodeURIComponent(shown.phoneKey)}`} target="_blank" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              See all {shown.visits} bills
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
