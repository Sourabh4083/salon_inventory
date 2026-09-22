import { prisma, type Db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type AuditAction =
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_ARCHIVED"
  | "PRODUCT_RESTORED"
  | "PRODUCT_DELETED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DISABLED"
  | "USER_ENABLED"
  | "USER_PASSWORD_RESET"
  | "SETTINGS_UPDATED"
  | "CATEGORY_CREATED"
  | "BILL_CREATED"
  | "BILL_CANCELLED"
  | "SERVICE_CREATED"
  | "SERVICE_UPDATED"
  | "EMPLOYEE_CREATED"
  | "EMPLOYEE_UPDATED"
  | "EMPLOYEE_DEACTIVATED"
  | "EMPLOYEE_REACTIVATED"
  | "EMPLOYEE_DOCUMENT_UPLOADED"
  | "EMPLOYEE_DOCUMENT_DELETED"
  | "SALARY_PAYMENT_RECORDED"
  | "SALARY_PAYMENT_DELETED"
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_RECEIVED"
  | "ORDER_CLOSED"
  | "LOGIN";

type TxClient = Prisma.TransactionClient | Db;

export async function recordAudit(
  client: TxClient,
  input: {
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    summary: string;
    metadata?: Prisma.InputJsonValue;
    actorId?: string | null;
  },
) {
  return client.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata,
      actorId: input.actorId ?? null,
    },
  });
}

export async function listAuditLogs(limit = 50) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { id: true, name: true, role: true } } },
  });
}
