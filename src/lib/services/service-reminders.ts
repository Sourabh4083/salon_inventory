import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/services/audit";
import { LINKABLE_STATUSES, OPEN_STATUSES } from "@/lib/services/enquiries";
import { addDaysInZone, addMonthsInZone } from "@/lib/timezone";
import { phoneKey } from "@/lib/phone";
import { REPLACE_AFTER_MONTHS, SERVICE_EVERY_DAYS, SERVICE_MIN_GAP_DAYS } from "@/lib/constants";

/**
 * Servicing reminders on the Calls page. Selling a product whose category "needs servicing"
 * (wigs, hair systems, ...) to a customer with a phone number adds ONE Calls card: SERVICE,
 * due 25 days later. A later bill from the same number (15+ days on) counts as the servicing
 * visit and the next card is due 25 days after it. Once the replacement date (7 months after
 * buying) comes, the card turns into REPLACE (see rollOverDueReplacements in enquiries.ts).
 * Buying a new one starts over. Everything runs inside the bill's transaction.
 */

type Tx = Prisma.TransactionClient;
export type ReminderBill = { id: string; billNumber: string; customerName: string | null; customerPhone: string | null; createdAt: Date };
type Line = { productId?: string | null; name: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_KINDS = ["SERVICE", "REPLACE"] as const;

export const serviceDueOn = (from: Date) => addDaysInZone(from, SERVICE_EVERY_DAYS);
export const replaceDueOn = (bought: Date) => addMonthsInZone(bought, REPLACE_AFTER_MONTHS);

/** Names of the bill's products that need servicing, each once, in bill order. */
export async function productsNeedingService(tx: Tx, lines: Line[]): Promise<string[]> {
  const ids = [...new Set(lines.map((l) => l.productId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  const flagged = await tx.product.findMany({ where: { id: { in: ids }, category: { needsService: true } }, select: { id: true } });
  const ok = new Set(flagged.map((p) => p.id));
  return [...new Set(lines.filter((l) => l.productId && ok.has(l.productId)).map((l) => l.name))];
}

/** Closes the number's open reminder (a new product was bought) and adds a fresh servicing card. */
async function startReminders(tx: Tx, bill: ReminderBill, key: string, products: string[], actorId: string) {
  await tx.enquiry.updateMany({
    where: { phoneKey: key, kind: { in: [...REMINDER_KINDS] }, status: { in: OPEN_STATUSES }, sourceBillId: { not: bill.id } },
    data: { status: "VISITED", visitedBillId: bill.id, visitedAt: bill.createdAt, nextCallOn: null, comingOn: null },
  });
  const common = { name: bill.customerName, phone: bill.customerPhone!, phoneKey: key, interest: products.join(", "), status: "CALL_BACK" as const, sourceBillId: bill.id, createdById: actorId };
  await tx.enquiry.create({ data: { ...common, kind: "SERVICE", nextCallOn: serviceDueOn(bill.createdAt), cycleStart: bill.createdAt } });
  await recordAudit(tx, {
    action: "SERVICE_REMINDERS_STARTED",
    entityType: "Bill",
    entityId: bill.id,
    summary: `${bill.billNumber}: servicing call added for ${bill.customerName ? `${bill.customerName} (${bill.customerPhone})` : bill.customerPhone} (${products.join(", ")})`,
    actorId,
  });
}

/**
 * A bill without such products, 15+ days into the customer's servicing round, is their
 * servicing visit: that card closes and the next one is added, for servicing or, when the next
 * servicing would fall after the replacement date, for the replacement.
 */
async function countAsServiceVisit(tx: Tx, bill: ReminderBill, key: string, actorId: string) {
  const svc = await tx.enquiry.findFirst({
    where: { phoneKey: key, kind: "SERVICE", status: { in: LINKABLE_STATUSES } },
    orderBy: { createdAt: "desc" },
    include: { sourceBill: { select: { createdAt: true, status: true } } },
  });
  if (!svc?.cycleStart || !svc.sourceBill || svc.sourceBill.status !== "COMPLETED") return;
  if (bill.createdAt.getTime() - svc.cycleStart.getTime() < SERVICE_MIN_GAP_DAYS * DAY_MS) return;
  const replaceOn = replaceDueOn(svc.sourceBill.createdAt);
  if (bill.createdAt >= replaceOn) return;

  await tx.enquiry.update({
    where: { id: svc.id },
    data: { status: "VISITED", visitedBillId: bill.id, visitedAt: bill.createdAt, nextCallOn: null, comingOn: null, name: svc.name ?? bill.customerName },
  });
  const next = serviceDueOn(bill.createdAt);
  const serviceAgain = next <= replaceOn;
  await tx.enquiry.create({
    data: {
      kind: serviceAgain ? "SERVICE" : "REPLACE",
      name: svc.name ?? bill.customerName,
      phone: bill.customerPhone ?? svc.phone,
      phoneKey: key,
      interest: svc.interest,
      status: "CALL_BACK",
      nextCallOn: serviceAgain ? next : replaceOn,
      cycleStart: bill.createdAt,
      sourceBillId: svc.sourceBillId,
      createdById: actorId,
    },
  });
  await recordAudit(tx, {
    action: "ENQUIRY_VISITED",
    entityType: "Enquiry",
    entityId: svc.id,
    summary: `${svc.name ?? bill.customerName ?? svc.phone} came for servicing (${bill.billNumber})${serviceAgain ? "" : "; next call is for replacement"}`,
    actorId,
  });
}

/** After a new bill is saved: start reminders for a product that needs servicing, or count the visit as servicing. */
export async function updateServiceReminders(tx: Tx, bill: ReminderBill, lines: Line[], actorId: string): Promise<void> {
  const key = phoneKey(bill.customerPhone);
  if (!key) return;
  const products = await productsNeedingService(tx, lines);
  if (products.length) await startReminders(tx, bill, key, products, actorId);
  else await countAsServiceVisit(tx, bill, key, actorId);
}

/**
 * After a category stops needing servicing: open reminders whose bill no longer has any
 * product that needs servicing are removed if nobody has called them yet (once staff have
 * talked to the customer, the entry stays). The rest get their product list refreshed.
 */
export async function pruneReminders(tx: Tx, actorId: string): Promise<{ removed: number; updated: number }> {
  const open = await tx.enquiry.findMany({
    where: { kind: { in: [...REMINDER_KINDS] }, status: { in: OPEN_STATUSES }, sourceBillId: { not: null } },
    include: { sourceBill: { select: { items: { select: { productId: true, name: true }, orderBy: { sortOrder: "asc" } } } }, _count: { select: { calls: true } } },
  });
  const remove: string[] = [];
  let updated = 0;
  for (const e of open) {
    const names = await productsNeedingService(tx, e.sourceBill?.items ?? []);
    if (!names.length) {
      if (e._count.calls === 0) remove.push(e.id);
    } else if (names.join(", ") !== e.interest) {
      await tx.enquiry.update({ where: { id: e.id }, data: { interest: names.join(", ") } });
      updated++;
    }
  }
  if (remove.length) await tx.enquiry.deleteMany({ where: { id: { in: remove } } });
  if (remove.length || updated) {
    await recordAudit(tx, {
      action: "SERVICE_REMINDERS_REMOVED",
      entityType: "Enquiry",
      summary: `Servicing calls tidied after a category change: ${remove.length} removed, ${updated} updated`,
      metadata: { removedIds: remove },
      actorId,
    });
  }
  return { removed: remove.length, updated };
}

export type BillReminderNote = { serviceOn: string | null; replaceOn: string | null; countedAsService: boolean };

/**
 * For the "Bill saved" note: the servicing card this bill added (a product that needs servicing
 * was sold) with its servicing and replacement dates, or that it counted as a servicing visit
 * and when the next call is (servicing, or the replacement when that comes first).
 */
export async function getBillReminderNote(billId: string): Promise<BillReminderNote | null> {
  const [started, visit] = await Promise.all([
    prisma.enquiry.findFirst({
      where: { sourceBillId: billId, kind: "SERVICE", status: { in: OPEN_STATUSES } },
      select: { nextCallOn: true, sourceBill: { select: { createdAt: true } } },
    }),
    prisma.enquiry.findFirst({ where: { visitedBillId: billId, kind: "SERVICE" }, select: { sourceBillId: true, visitedAt: true } }),
  ]);
  if (started?.sourceBill) {
    return { serviceOn: started.nextCallOn?.toISOString() ?? null, replaceOn: replaceDueOn(started.sourceBill.createdAt).toISOString(), countedAsService: false };
  }
  if (!visit?.sourceBillId) return null;
  const next = await prisma.enquiry.findFirst({
    where: { sourceBillId: visit.sourceBillId, kind: { in: [...REMINDER_KINDS] }, status: { in: OPEN_STATUSES }, cycleStart: visit.visitedAt },
    select: { kind: true, nextCallOn: true },
  });
  const on = next?.nextCallOn?.toISOString() ?? null;
  return { serviceOn: next?.kind === "SERVICE" ? on : null, replaceOn: next?.kind === "REPLACE" ? on : null, countedAsService: true };
}

/** A cancelled bill's product was never sold: its open reminders go. */
export async function removeRemindersForBill(tx: Tx, bill: { id: string; billNumber: string }, actorId: string): Promise<number> {
  const { count } = await tx.enquiry.deleteMany({ where: { sourceBillId: bill.id, status: { in: OPEN_STATUSES } } });
  if (count) {
    await recordAudit(tx, {
      action: "SERVICE_REMINDERS_REMOVED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `${bill.billNumber}: ${count} servicing/replacement call${count === 1 ? "" : "s"} removed`,
      actorId,
    });
  }
  return count;
}

/**
 * After the owner edits a bill. Keeps its reminders in step with the bill:
 * - products needing service or the phone removed → its open reminders go;
 * - such products added to a bill that had none → reminders start from the bill's date
 *   (unless the number already bought one later, which then drives the reminders);
 * - still such a bill → open reminders follow the new phone, products and date. A date
 *   the staff picked on a call (call back / coming) is left alone.
 */
export async function syncRemindersForEditedBill(tx: Tx, bill: ReminderBill, previousDate: Date, lines: Line[], actorId: string): Promise<void> {
  const key = phoneKey(bill.customerPhone);
  const products = await productsNeedingService(tx, lines);
  if (!key || !products.length) {
    await removeRemindersForBill(tx, bill, actorId);
    return;
  }

  const existing = await tx.enquiry.findMany({ where: { sourceBillId: bill.id }, include: { _count: { select: { calls: true } } } });
  if (!existing.length) {
    const newer = await tx.enquiry.findFirst({ where: { phoneKey: key, kind: { in: [...REMINDER_KINDS] }, sourceBill: { createdAt: { gt: bill.createdAt } } } });
    if (!newer) await startReminders(tx, bill, key, products, actorId);
    return;
  }

  const open = existing.filter((e) => OPEN_STATUSES.includes(e.status));
  for (const e of open) {
    const untouched = e._count.calls === 0;
    const firstRound = e.kind === "SERVICE" && e.cycleStart?.getTime() === previousDate.getTime();
    const data: Prisma.EnquiryUpdateInput = { phone: bill.customerPhone!, phoneKey: key, interest: products.join(", "), name: e.name ?? bill.customerName };
    if (e.kind === "REPLACE" && untouched) data.nextCallOn = replaceDueOn(bill.createdAt);
    if (firstRound) {
      data.cycleStart = bill.createdAt;
      if (untouched) data.nextCallOn = serviceDueOn(bill.createdAt);
    }
    await tx.enquiry.update({ where: { id: e.id }, data });
  }
  if (open.length) {
    await recordAudit(tx, {
      action: "SERVICE_REMINDERS_CHANGED",
      entityType: "Bill",
      entityId: bill.id,
      summary: `${bill.billNumber}: servicing/replacement calls updated after the bill was edited`,
      actorId,
    });
  }
}
