import { cache } from "react";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { EmployeeDocumentKind, PaymentMethod } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/services/audit";
import { fromPaise, toPaise } from "@/lib/money";
import { zonedDate, zonedParts } from "@/lib/timezone";
import { EMPLOYEE_DOC_MAX_BYTES, EMPLOYEE_DOC_MAX_COUNT, EMPLOYEE_DOC_MIME } from "@/lib/constants";
import type { SessionUser } from "@/lib/auth/session";
import type { z } from "zod";
import type { employeeSchema, salaryPaymentSchema } from "@/lib/validation/schemas";

/* ---------- DTOs ---------- */

export type EmployeeDTO = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  designation: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  isActive: boolean;
  aadhaarNumber: string | null;
  aadhaarLast4: string | null;
  monthlySalary: string | null;
  notes: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Metadata only. The bytes are streamed by the /api/employees route, never sent to the client as JSON. */
export type EmployeeDocumentDTO = {
  id: string;
  employeeId: string;
  kind: EmployeeDocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: string;
  uploadedByName: string | null;
};

export type SalaryPaymentDTO = {
  id: string;
  employeeId: string;
  amount: string;
  paidOn: string;
  periodMonth: string | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  createdAt: string;
  createdByName: string;
};

export type EmployeeDetail = {
  employee: EmployeeDTO;
  documents: EmployeeDocumentDTO[];
  payments: SalaryPaymentDTO[];
  paidThisYear: string;
  lastPaidOn: string | null;
};

const employeeInclude = { _count: { select: { documents: true } } } satisfies Prisma.EmployeeInclude;
type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

function toEmployeeDTO(e: EmployeeRow): EmployeeDTO {
  return {
    id: e.id,
    name: e.name,
    phone: e.phone,
    email: e.email,
    address: e.address,
    designation: e.designation,
    joinedAt: e.joinedAt ? e.joinedAt.toISOString() : null,
    leftAt: e.leftAt ? e.leftAt.toISOString() : null,
    isActive: e.isActive,
    aadhaarNumber: e.aadhaarNumber,
    aadhaarLast4: e.aadhaarNumber ? e.aadhaarNumber.slice(-4) : null,
    monthlySalary: e.monthlySalary ? e.monthlySalary.toString() : null,
    notes: e.notes,
    documentCount: e._count.documents,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

const documentSelect = {
  id: true,
  employeeId: true,
  kind: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} satisfies Prisma.EmployeeDocumentSelect;

function toDocumentDTO(d: Prisma.EmployeeDocumentGetPayload<{ select: typeof documentSelect }>): EmployeeDocumentDTO {
  return {
    id: d.id,
    employeeId: d.employeeId,
    kind: d.kind,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    url: `/api/employees/${d.employeeId}/documents/${d.id}`,
    createdAt: d.createdAt.toISOString(),
    uploadedByName: d.uploadedBy?.name ?? null,
  };
}

const paymentInclude = { createdBy: { select: { name: true } } } satisfies Prisma.SalaryPaymentInclude;

function toPaymentDTO(p: Prisma.SalaryPaymentGetPayload<{ include: typeof paymentInclude }>): SalaryPaymentDTO {
  return {
    id: p.id,
    employeeId: p.employeeId,
    amount: p.amount.toString(),
    paidOn: p.paidOn.toISOString(),
    periodMonth: p.periodMonth,
    paymentMethod: p.paymentMethod,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    createdByName: p.createdBy.name,
  };
}

/* ---------- Guards ---------- */

/** Employee records (personal details, Aadhaar, salary) are strictly owner-only, even at the service layer. */
function assertOwner(actor: SessionUser) {
  if (actor.role !== "OWNER") throw new AppError("Only the owner can manage employees.", "FORBIDDEN");
}

/* ---------- Queries ---------- */

export type EmployeeStatusFilter = "active" | "inactive" | "all";

export async function listEmployees(params: { q?: string; status?: EmployeeStatusFilter } = {}, actor: SessionUser): Promise<EmployeeDTO[]> {
  assertOwner(actor);
  const q = params.q?.trim() ?? "";
  const where: Prisma.EmployeeWhereInput = {};
  const status = params.status ?? "active";
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/\D/g, "") || q } },
      { designation: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.employee.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], include: employeeInclude });
  return rows.map(toEmployeeDTO);
}

/** Deduplicated per request (generateMetadata and the page both read it). */
export const getEmployee = cache(async (id: string, actor: SessionUser): Promise<EmployeeDetail | null> => {
  assertOwner(actor);
  const [row, documents, payments] = await Promise.all([
    prisma.employee.findUnique({ where: { id }, include: employeeInclude }),
    prisma.employeeDocument.findMany({ where: { employeeId: id }, orderBy: { createdAt: "asc" }, select: documentSelect }),
    prisma.salaryPayment.findMany({ where: { employeeId: id }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }], include: paymentInclude }),
  ]);
  if (!row) return null;
  const yearStart = zonedDate(zonedParts(new Date()).year, 1, 1);
  const paidThisYear = payments.reduce((sum, p) => (p.paidOn >= yearStart ? sum + toPaise(p.amount.toString()) : sum), 0);
  return {
    employee: toEmployeeDTO(row),
    documents: documents.map(toDocumentDTO),
    payments: payments.map(toPaymentDTO),
    paidThisYear: fromPaise(paidThisYear),
    lastPaidOn: payments[0]?.paidOn.toISOString() ?? null,
  };
});

/* ---------- Mutations ---------- */

type EmployeeInput = z.output<typeof employeeSchema>;

function employeeData(input: EmployeeInput) {
  return {
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    designation: input.designation,
    joinedAt: input.joinedAt,
    leftAt: input.leftAt,
    aadhaarNumber: input.aadhaarNumber,
    monthlySalary: input.monthlySalary,
    notes: input.notes,
  };
}

export async function createEmployee(input: EmployeeInput, actor: SessionUser): Promise<EmployeeDTO> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: { ...employeeData(input), createdById: actor.id, updatedById: actor.id },
      include: employeeInclude,
    });
    await recordAudit(tx, {
      action: "EMPLOYEE_CREATED",
      entityType: "Employee",
      entityId: employee.id,
      summary: `Added employee "${employee.name}"${employee.designation ? ` (${employee.designation})` : ""}`,
      actorId: actor.id,
    });
    return employee;
  });
  return toEmployeeDTO(created);
}

export async function updateEmployee(id: string, input: EmployeeInput, actor: SessionUser): Promise<EmployeeDTO> {
  assertOwner(actor);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id } });
    if (!existing) throw new AppError("Employee not found.", "NOT_FOUND");
    const data = employeeData(input);
    const changed: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      const before = existing[key as keyof typeof existing];
      const b = before instanceof Prisma.Decimal ? before.toString() : before instanceof Date ? before.toISOString() : (before ?? null);
      const a = value instanceof Date ? value.toISOString() : (value ?? null);
      if (String(b ?? "") !== String(a ?? "")) changed.push(key);
    }
    const employee = await tx.employee.update({ where: { id }, data: { ...data, updatedById: actor.id }, include: employeeInclude });
    await recordAudit(tx, {
      action: "EMPLOYEE_UPDATED",
      entityType: "Employee",
      entityId: id,
      summary: `Edited employee "${employee.name}"${changed.length ? ` (${changed.join(", ")})` : ""}`,
      metadata: { changedFields: changed },
      actorId: actor.id,
    });
    return employee;
  });
  return toEmployeeDTO(updated);
}

export async function setEmployeeActive(id: string, active: boolean, actor: SessionUser): Promise<EmployeeDTO> {
  assertOwner(actor);
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findUnique({ where: { id } });
    if (!existing) throw new AppError("Employee not found.", "NOT_FOUND");
    const employee = await tx.employee.update({
      where: { id },
      data: {
        isActive: active,
        // Leaving date is filled in automatically when deactivating; cleared when reactivating.
        leftAt: active ? null : (existing.leftAt ?? new Date()),
        updatedById: actor.id,
      },
      include: employeeInclude,
    });
    await recordAudit(tx, {
      action: active ? "EMPLOYEE_REACTIVATED" : "EMPLOYEE_DEACTIVATED",
      entityType: "Employee",
      entityId: id,
      summary: `${active ? "Reactivated" : "Deactivated"} employee "${employee.name}"`,
      actorId: actor.id,
    });
    return employee;
  });
  return toEmployeeDTO(updated);
}

/* ---------- Documents ---------- */

export async function addEmployeeDocument(
  employeeId: string,
  file: { kind: EmployeeDocumentKind; fileName: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> },
  actor: SessionUser,
): Promise<EmployeeDocumentDTO> {
  assertOwner(actor);
  if (!EMPLOYEE_DOC_MIME.includes(file.mimeType)) throw new AppError("Upload a JPG, PNG, WebP image or a PDF.");
  if (file.bytes.byteLength === 0) throw new AppError("The selected file is empty.");
  if (file.bytes.byteLength > EMPLOYEE_DOC_MAX_BYTES) {
    throw new AppError(`File is too large. Maximum size is ${Math.round(EMPLOYEE_DOC_MAX_BYTES / 1024 / 1024)} MB.`);
  }
  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, _count: { select: { documents: true } } } });
    if (!employee) throw new AppError("Employee not found.", "NOT_FOUND");
    if (employee._count.documents >= EMPLOYEE_DOC_MAX_COUNT) {
      throw new AppError(`An employee can have at most ${EMPLOYEE_DOC_MAX_COUNT} documents. Delete one first.`);
    }
    const inserted = await tx.employeeDocument.create({
      data: {
        employeeId,
        kind: file.kind,
        fileName: file.fileName.slice(0, 200) || "document",
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        data: file.bytes,
        uploadedById: actor.id,
      },
      select: { id: true },
    });
    const doc = await tx.employeeDocument.findUniqueOrThrow({ where: { id: inserted.id }, select: documentSelect });
    await recordAudit(tx, {
      action: "EMPLOYEE_DOCUMENT_UPLOADED",
      entityType: "Employee",
      entityId: employeeId,
      summary: `Uploaded ${file.kind.toLowerCase().replace(/_/g, " ")} "${doc.fileName}" for employee "${employee.name}"`,
      actorId: actor.id,
    });
    return doc;
  });
  return toDocumentDTO(created);
}

export async function deleteEmployeeDocument(documentId: string, actor: SessionUser): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const doc = await tx.employeeDocument.findUnique({ where: { id: documentId }, select: { id: true, fileName: true, employeeId: true, employee: { select: { name: true } } } });
    if (!doc) throw new AppError("Document not found.", "NOT_FOUND");
    await tx.employeeDocument.delete({ where: { id: documentId } });
    await recordAudit(tx, {
      action: "EMPLOYEE_DOCUMENT_DELETED",
      entityType: "Employee",
      entityId: doc.employeeId,
      summary: `Deleted document "${doc.fileName}" of employee "${doc.employee.name}"`,
      actorId: actor.id,
    });
  });
}

/** Bytes for the download route. The caller must have verified the viewer is the owner. */
export async function getEmployeeDocumentFile(employeeId: string, documentId: string) {
  const doc = await prisma.employeeDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.employeeId !== employeeId) return null;
  return { fileName: doc.fileName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, data: doc.data };
}

/* ---------- Salary payments ---------- */

type SalaryPaymentInput = z.output<typeof salaryPaymentSchema>;

export async function addSalaryPayment(input: SalaryPaymentInput, actor: SessionUser): Promise<SalaryPaymentDTO> {
  assertOwner(actor);
  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { name: true } });
    if (!employee) throw new AppError("Employee not found.", "NOT_FOUND");
    const payment = await tx.salaryPayment.create({
      data: {
        employeeId: input.employeeId,
        amount: input.amount,
        paidOn: input.paidOn,
        periodMonth: input.periodMonth,
        paymentMethod: input.paymentMethod,
        note: input.note,
        createdById: actor.id,
      },
      include: paymentInclude,
    });
    await recordAudit(tx, {
      action: "SALARY_PAYMENT_RECORDED",
      entityType: "Employee",
      entityId: input.employeeId,
      summary: `Paid salary ${input.amount} to "${employee.name}"${input.periodMonth ? ` for ${input.periodMonth}` : ""} (${input.paymentMethod})`,
      metadata: { paymentId: payment.id, amount: input.amount, periodMonth: input.periodMonth },
      actorId: actor.id,
    });
    return payment;
  });
  return toPaymentDTO(created);
}

export async function deleteSalaryPayment(paymentId: string, actor: SessionUser): Promise<void> {
  assertOwner(actor);
  await prisma.$transaction(async (tx) => {
    const payment = await tx.salaryPayment.findUnique({ where: { id: paymentId }, include: { employee: { select: { name: true } } } });
    if (!payment) throw new AppError("Payment not found.", "NOT_FOUND");
    await tx.salaryPayment.delete({ where: { id: paymentId } });
    await recordAudit(tx, {
      action: "SALARY_PAYMENT_DELETED",
      entityType: "Employee",
      entityId: payment.employeeId,
      summary: `Removed salary payment ${payment.amount.toString()} of "${payment.employee.name}"`,
      metadata: { paymentId, amount: payment.amount.toString(), paidOn: payment.paidOn.toISOString() },
      actorId: actor.id,
    });
  });
}
