import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/services/audit";
import { fromPaise, toPaise } from "@/lib/money";
import { can } from "@/lib/permissions";
import type { OpenBillData } from "@/lib/validation/schemas";

/* ---------- DTOs ---------- */

export type OpenBillLine = {
  kind: "PRODUCT" | "SERVICE";
  productId?: string;
  serviceId?: string | null;
  name: string;
  quantity: number;
  /** As typed; may be blank until the bill is completed. */
  unitPrice: string;
  /** Products only: units in stock right now. */
  available?: number;
};

export type OpenBillDTO = {
  id: string;
  employeeIds: string[];
  employeeNames: string[];
  customerName: string | null;
  customerPhone: string | null;
  discount: string;
  notes: string | null;
  lines: OpenBillLine[];
  itemCount: number;
  /** Running total of what has been added so far. */
  total: string;
  createdAt: string;
  updatedAt: string;
};

const openBillInclude = { employees: { select: { id: true, name: true }, orderBy: { name: "asc" } } } satisfies Prisma.OpenBillInclude;

type OpenBillRow = Prisma.OpenBillGetPayload<{ include: typeof openBillInclude }>;

function toOpenBillDTO(b: OpenBillRow, lines = b.lines as unknown as OpenBillLine[]): OpenBillDTO {
  const subtotal = lines.reduce((sum, l) => sum + toPaise(l.unitPrice) * l.quantity, 0);
  return {
    id: b.id,
    employeeIds: b.employees.map((e) => e.id),
    employeeNames: b.employees.map((e) => e.name),
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    discount: b.discount ?? "",
    notes: b.notes,
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    total: fromPaise(Math.max(0, subtotal - Math.max(0, toPaise(b.discount)))),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function assertCanBill(actor: SessionUser) {
  if (!can(actor.role, "bill.create")) throw new AppError("You cannot make bills.", "FORBIDDEN");
}

const GONE = "This open bill was already completed or discarded.";

/* ---------- Read ---------- */

/** Customers in the shop right now, longest-waiting first. */
export async function listOpenBills(): Promise<OpenBillDTO[]> {
  const rows = await prisma.openBill.findMany({ orderBy: { createdAt: "asc" }, include: openBillInclude });
  return rows.map((r) => toOpenBillDTO(r));
}

/** For the composer: lines carry current stock, and products deleted or archived since are dropped. */
export async function getOpenBill(id: string): Promise<OpenBillDTO | null> {
  const row = await prisma.openBill.findUnique({ where: { id }, include: openBillInclude });
  if (!row) return null;
  const stored = row.lines as unknown as OpenBillLine[];
  const productIds = stored.flatMap((l) => (l.kind === "PRODUCT" && l.productId ? [l.productId] : []));
  const products = new Map(
    (await prisma.product.findMany({ where: { id: { in: productIds }, status: "ACTIVE" }, select: { id: true, name: true, quantity: true } })).map((p) => [p.id, p]),
  );
  const lines = stored.flatMap((l): OpenBillLine[] => {
    if (l.kind !== "PRODUCT") return [l];
    const p = l.productId ? products.get(l.productId) : undefined;
    return p ? [{ ...l, name: p.name, available: p.quantity }] : [];
  });
  return toOpenBillDTO(row, lines);
}

/** Names for the "Handled by" picker. `alsoIds` keeps a bill's employees listed after they are deactivated. */
export async function listBillingEmployees(alsoIds: string[] = []): Promise<{ id: string; name: string }[]> {
  return prisma.employee.findMany({
    where: alsoIds.length ? { OR: [{ isActive: true }, { id: { in: alsoIds } }] } : { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/* ---------- Mutations ---------- */

/**
 * "Handled by" may only name employees who are currently working. Those already on the
 * bill (`keepIds`) stay allowed after they are deactivated, so the bill can still be saved.
 */
export async function assertBillingEmployees(db: Prisma.TransactionClient, ids: string[], keepIds: string[] = []) {
  if (!ids.length) return;
  const found = await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true } });
  const ok = new Set(found.filter((e) => e.isActive || keepIds.includes(e.id)).map((e) => e.id));
  if (ids.some((id) => !ok.has(id))) throw new AppError("Choose employees who are currently working.");
}

/** Opens a bill for a customer in the shop, or saves what was added to one already open. Stock is not touched. */
export async function saveOpenBill(data: OpenBillData, actor: SessionUser): Promise<OpenBillDTO> {
  assertCanBill(actor);
  const existing = data.id ? await prisma.openBill.findUnique({ where: { id: data.id }, select: { employees: { select: { id: true } } } }) : null;
  if (data.id && !existing) throw new AppError(GONE, "CONFLICT");
  await assertBillingEmployees(prisma, data.employeeIds, existing?.employees.map((e) => e.id));

  const employees = data.employeeIds.map((id) => ({ id }));
  const fields = {
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    discount: data.discount,
    notes: data.notes,
    lines: data.items as Prisma.InputJsonValue,
  };
  const row = data.id
    ? await prisma.openBill.update({ where: { id: data.id }, data: { ...fields, employees: { set: employees } }, include: openBillInclude })
    : await prisma.openBill.create({ data: { ...fields, employees: { connect: employees }, createdById: actor.id }, include: openBillInclude });
  return toOpenBillDTO(row);
}

/** The customer left without a bill. Kept in the audit log with what the open bill held. */
export async function discardOpenBill(id: string, actor: SessionUser): Promise<void> {
  assertCanBill(actor);
  await prisma.$transaction(async (tx) => {
    const row = await tx.openBill.findUnique({ where: { id }, include: openBillInclude });
    if (!row) throw new AppError(GONE, "CONFLICT");
    await tx.openBill.delete({ where: { id } });
    const bill = toOpenBillDTO(row);
    await recordAudit(tx, {
      action: "OPEN_BILL_DISCARDED",
      entityType: "OpenBill",
      entityId: id,
      summary: `Discarded open bill handled by ${bill.employeeNames.join(", ")}${bill.customerName ? ` for ${bill.customerName}` : ""} (${bill.total}: ${bill.lines
        .map((l) => (l.quantity > 1 ? `${l.quantity}× ${l.name}` : l.name))
        .join(", ")})`,
      actorId: actor.id,
    });
  });
}
