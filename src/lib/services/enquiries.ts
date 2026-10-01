import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { CallResult, EnquiryStatus } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { recordAudit } from "@/lib/services/audit";
import { endOfDay, startOfDay } from "@/lib/dates";
import { addDaysInZone } from "@/lib/timezone";
import { phoneKey } from "@/lib/phone";
import { PAGE_SIZE } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";
import type { AddNumbersData, CallLogData, EnquiryEditData } from "@/lib/validation/schemas";

/**
 * New-customer leads the manager phones: numbers from JustDial/WhatsApp and people
 * who called the salon. Each call is logged with what the customer said; the
 * enquiry closes as VISITED when a bill is made for the same number.
 */

export const OPEN_STATUSES: EnquiryStatus[] = ["NEW", "NO_ANSWER", "CALL_BACK", "COMING"];
const CLOSED_STATUSES: EnquiryStatus[] = ["VISITED", "NOT_INTERESTED"];

export type CallsTab = "today" | "coming" | "later" | "closed";
export const CALLS_TABS: CallsTab[] = ["today", "coming", "later", "closed"];

export type EnquiryCallDTO = {
  id: string;
  result: CallResult;
  note: string | null;
  followUpOn: string | null;
  calledAt: string;
  calledByName: string;
};

export type EnquiryDTO = {
  id: string;
  name: string | null;
  phone: string;
  interest: string | null;
  status: EnquiryStatus;
  nextCallOn: string | null;
  comingOn: string | null;
  visitedAt: string | null;
  visitedBillId: string | null;
  visitedBillNumber: string | null;
  createdAt: string;
  createdByName: string;
  calls: EnquiryCallDTO[];
};

const enquiryInclude = {
  createdBy: { select: { name: true } },
  visitedBill: { select: { billNumber: true } },
  calls: { orderBy: { calledAt: "desc" }, include: { calledBy: { select: { name: true } } } },
} satisfies Prisma.EnquiryInclude;
type EnquiryRow = Prisma.EnquiryGetPayload<{ include: typeof enquiryInclude }>;

function toEnquiryDTO(e: EnquiryRow): EnquiryDTO {
  return {
    id: e.id,
    name: e.name,
    phone: e.phone,
    interest: e.interest,
    status: e.status,
    nextCallOn: e.nextCallOn?.toISOString() ?? null,
    comingOn: e.comingOn?.toISOString() ?? null,
    visitedAt: e.visitedAt?.toISOString() ?? null,
    visitedBillId: e.visitedBillId,
    visitedBillNumber: e.visitedBill?.billNumber ?? null,
    createdAt: e.createdAt.toISOString(),
    createdByName: e.createdBy.name,
    calls: e.calls.map((c) => ({
      id: c.id,
      result: c.result,
      note: c.note,
      followUpOn: c.followUpOn?.toISOString() ?? null,
      calledAt: c.calledAt.toISOString(),
      calledByName: c.calledBy.name,
    })),
  };
}

function assertCan(actor: SessionUser) {
  if (!can(actor.role, "enquiry.manage")) throw new AppError("You cannot manage calls.", "FORBIDDEN");
}

function label(e: { name: string | null; phone: string }) {
  return e.name ? `${e.name} (${e.phone})` : e.phone;
}

/* ---------- Queries ---------- */

function tabWhere(tab: CallsTab, now: Date): Prisma.EnquiryWhereInput {
  const today = startOfDay(now);
  const todayEnd = endOfDay(now);
  switch (tab) {
    case "today":
      // Not called yet, a call-back / retry that is due, or a "coming" day that passed without a visit.
      return {
        OR: [
          { status: "NEW" },
          { status: { in: ["NO_ANSWER", "CALL_BACK"] }, nextCallOn: { lte: todayEnd } },
          { status: "COMING", comingOn: { lt: today } },
        ],
      };
    case "coming":
      return { status: "COMING", comingOn: { gte: today } };
    case "later":
      return { status: { in: ["NO_ANSWER", "CALL_BACK"] }, nextCallOn: { gt: todayEnd } };
    case "closed":
      return { status: { in: CLOSED_STATUSES } };
  }
}

function searchWhere(search: string | undefined): Prisma.EnquiryWhereInput | undefined {
  const q = search?.trim();
  if (!q) return undefined;
  // Stored keys have no country code or trunk 0, so drop them from the typed number too.
  let key = q.replace(/\D/g, "");
  if (q.startsWith("+") && key.startsWith("91")) key = key.slice(2);
  key = key.replace(/^0+/, "");
  return {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { interest: { contains: q, mode: "insensitive" } },
      ...(key.length >= 3 ? [{ phoneKey: { contains: key.slice(-10) } }] : []),
    ],
  };
}

/** New numbers first (newest on top), then follow-ups by how long they have been due. */
function todayOrder(a: EnquiryRow, b: EnquiryRow) {
  const aNew = a.status === "NEW";
  const bNew = b.status === "NEW";
  if (aNew !== bNew) return aNew ? -1 : 1;
  if (aNew) return b.createdAt.getTime() - a.createdAt.getTime();
  const due = (e: EnquiryRow) => (e.status === "COMING" ? e.comingOn : e.nextCallOn)?.getTime() ?? 0;
  return due(a) - due(b);
}

export type EnquiryPage = { items: EnquiryDTO[]; total: number; page: number; pageSize: number; pageCount: number };

export async function listEnquiries(params: { tab: CallsTab; search?: string; page?: number; pageSize?: number }, actor: SessionUser, now = new Date()): Promise<EnquiryPage> {
  assertCan(actor);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? PAGE_SIZE));
  const search = searchWhere(params.search);
  const where: Prisma.EnquiryWhereInput = search ? { AND: [tabWhere(params.tab, now), search] } : tabWhere(params.tab, now);

  if (params.tab === "today") {
    // The day's call list is short; its order mixes two dates, so sort it here.
    const rows = (await prisma.enquiry.findMany({ where, include: enquiryInclude, take: 1000 })).sort(todayOrder);
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map(toEnquiryDTO),
      total: rows.length,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(rows.length / pageSize)),
    };
  }

  const orderBy: Prisma.EnquiryOrderByWithRelationInput[] =
    params.tab === "coming" ? [{ comingOn: "asc" }, { createdAt: "asc" }] : params.tab === "later" ? [{ nextCallOn: "asc" }, { createdAt: "asc" }] : [{ updatedAt: "desc" }];
  const [rows, total] = await Promise.all([
    prisma.enquiry.findMany({ where, orderBy, include: enquiryInclude, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.enquiry.count({ where }),
  ]);
  return { items: rows.map(toEnquiryDTO), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function callsTabCounts(actor: SessionUser, now = new Date()): Promise<Record<CallsTab, number>> {
  assertCan(actor);
  const counts = await Promise.all(CALLS_TABS.map((tab) => prisma.enquiry.count({ where: tabWhere(tab, now) })));
  return Object.fromEntries(CALLS_TABS.map((tab, i) => [tab, counts[i]])) as Record<CallsTab, number>;
}

/* ---------- Mutations ---------- */

export type AddNumbersResult = { added: number; duplicates: string[]; invalid: string[] };

/** Adds pasted numbers as NEW enquiries, skipping any number that is already open. */
export async function addNumbers(input: AddNumbersData, actor: SessionUser): Promise<AddNumbersResult> {
  assertCan(actor);
  const byKey = new Map<string, string>();
  const duplicates: string[] = [];
  for (const phone of input.numbers) {
    const key = phoneKey(phone)!;
    if (byKey.has(key)) duplicates.push(phone);
    else byKey.set(key, phone);
  }

  return prisma.$transaction(async (tx) => {
    const open = await tx.enquiry.findMany({ where: { phoneKey: { in: [...byKey.keys()] }, status: { in: OPEN_STATUSES } }, select: { phoneKey: true } });
    for (const { phoneKey: key } of open) {
      if (byKey.has(key)) {
        duplicates.push(byKey.get(key)!);
        byKey.delete(key);
      }
    }
    const fresh = [...byKey.entries()];
    if (fresh.length) {
      await tx.enquiry.createMany({ data: fresh.map(([key, phone]) => ({ phone, phoneKey: key, createdById: actor.id })) });
      await recordAudit(tx, {
        action: "ENQUIRIES_ADDED",
        entityType: "Enquiry",
        summary: `Added ${fresh.length} number${fresh.length === 1 ? "" : "s"} to call`,
        metadata: { phones: fresh.map(([, phone]) => phone) },
        actorId: actor.id,
      });
    }
    return { added: fresh.length, duplicates, invalid: input.invalid };
  });
}

export async function updateEnquiry(id: string, input: EnquiryEditData, actor: SessionUser): Promise<EnquiryDTO> {
  assertCan(actor);
  const key = phoneKey(input.phone)!;
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.enquiry.findUnique({ where: { id } });
    if (!existing) throw new AppError("Enquiry not found.", "NOT_FOUND");
    if (key !== existing.phoneKey && OPEN_STATUSES.includes(existing.status)) {
      const clash = await tx.enquiry.findFirst({ where: { phoneKey: key, status: { in: OPEN_STATUSES }, id: { not: id } } });
      if (clash) throw new AppError(`${input.phone} is already in the call list${clash.name ? ` as ${clash.name}` : ""}.`);
    }
    const enquiry = await tx.enquiry.update({ where: { id }, data: { name: input.name, phone: input.phone, phoneKey: key, interest: input.interest }, include: enquiryInclude });
    await recordAudit(tx, {
      action: "ENQUIRY_UPDATED",
      entityType: "Enquiry",
      entityId: id,
      summary: `Edited enquiry ${label(enquiry)}`,
      metadata: { before: { name: existing.name, phone: existing.phone, interest: existing.interest } },
      actorId: actor.id,
    });
    return enquiry;
  });
  return toEnquiryDTO(updated);
}

const RESULT_TEXT: Record<CallResult, string> = {
  COMING: "coming",
  CALL_BACK: "call back later",
  NO_ANSWER: "no answer",
  NOT_INTERESTED: "not interested",
};

export async function logCall(input: CallLogData, actor: SessionUser, now = new Date()): Promise<EnquiryDTO> {
  assertCan(actor);
  const today = startOfDay(now);
  if (input.date && input.date < today) throw new AppError("The date cannot be in the past.");

  const followUpOn = input.result === "NO_ANSWER" ? addDaysInZone(today, 1) : input.result === "NOT_INTERESTED" ? null : input.date;
  const data: Prisma.EnquiryUpdateInput = {
    status: input.result,
    nextCallOn: input.result === "NO_ANSWER" || input.result === "CALL_BACK" ? followUpOn : null,
    comingOn: input.result === "COMING" ? followUpOn : null,
    name: input.name,
    interest: input.interest,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.enquiry.findUnique({ where: { id: input.enquiryId } });
    if (!existing) throw new AppError("Enquiry not found.", "NOT_FOUND");
    if (!OPEN_STATUSES.includes(existing.status)) throw new AppError("This enquiry is already closed.");
    await tx.enquiryCall.create({ data: { enquiryId: existing.id, result: input.result, note: input.note, followUpOn, calledById: actor.id, calledAt: now } });
    const enquiry = await tx.enquiry.update({ where: { id: existing.id }, data, include: enquiryInclude });
    await recordAudit(tx, {
      action: "ENQUIRY_CALL_LOGGED",
      entityType: "Enquiry",
      entityId: existing.id,
      summary: `Called ${label(enquiry)}: ${RESULT_TEXT[input.result]}`,
      actorId: actor.id,
    });
    return enquiry;
  });
  return toEnquiryDTO(updated);
}

/** For a customer who came but whose bill did not carry their number. */
export async function markVisited(id: string, actor: SessionUser, now = new Date()): Promise<EnquiryDTO> {
  assertCan(actor);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.enquiry.findUnique({ where: { id } });
    if (!existing) throw new AppError("Enquiry not found.", "NOT_FOUND");
    if (!OPEN_STATUSES.includes(existing.status)) throw new AppError("This enquiry is already closed.");
    const enquiry = await tx.enquiry.update({ where: { id }, data: { status: "VISITED", visitedAt: now, nextCallOn: null }, include: enquiryInclude });
    await recordAudit(tx, {
      action: "ENQUIRY_VISITED",
      entityType: "Enquiry",
      entityId: id,
      summary: `${label(enquiry)} marked as visited`,
      actorId: actor.id,
    });
    return enquiry;
  });
  return toEnquiryDTO(updated);
}

/**
 * Called inside the bill's transaction: the newest open enquiry for the bill's phone
 * number becomes VISITED and points at the bill.
 */
export async function closeEnquiryForBill(
  tx: Prisma.TransactionClient,
  bill: { id: string; billNumber: string; customerName: string | null; customerPhone: string | null; createdAt: Date },
  actorId: string,
): Promise<void> {
  const key = phoneKey(bill.customerPhone);
  if (!key) return;
  const enquiry = await tx.enquiry.findFirst({ where: { phoneKey: key, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" } });
  if (!enquiry) return;
  await tx.enquiry.update({
    where: { id: enquiry.id },
    data: { status: "VISITED", visitedBillId: bill.id, visitedAt: bill.createdAt, nextCallOn: null, name: enquiry.name ?? bill.customerName },
  });
  await recordAudit(tx, {
    action: "ENQUIRY_VISITED",
    entityType: "Enquiry",
    entityId: enquiry.id,
    summary: `${label({ name: enquiry.name ?? bill.customerName, phone: enquiry.phone })} visited (${bill.billNumber})`,
    actorId,
  });
}
