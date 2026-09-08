import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/services/audit";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/generated/prisma/enums";

export type UserDTO = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const select = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true } as const;

function toDTO(u: Prisma.UserGetPayload<{ select: typeof select }>): UserDTO {
  return { ...u, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString() };
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) return null;
  if (!user.isActive) throw new AppError("This account has been disabled. Please contact the owner.", "FORBIDDEN");
  await recordAudit(prisma, {
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} signed in`,
    actorId: user.id,
  });
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function listUsers(): Promise<UserDTO[]> {
  const rows = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], select });
  return rows.map(toDTO);
}

export async function createManager(
  input: { name: string; email: string; password: string },
  actor: SessionUser,
): Promise<UserDTO> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: input.name, email: input.email.toLowerCase(), passwordHash, role: "MANAGER" },
        select,
      });
      await recordAudit(tx, {
        action: "USER_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: `Created manager account for ${created.name} (${created.email})`,
        actorId: actor.id,
      });
      return created;
    });
    return toDTO(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("An account with this email already exists.", "CONFLICT");
    }
    throw err;
  }
}

/** Owner edits a manager's name / active status. Owner accounts cannot be changed here. */
export async function updateManager(
  input: { userId: string; name: string; isActive: boolean },
  actor: SessionUser,
): Promise<UserDTO> {
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: input.userId } });
    if (!existing) throw new AppError("User not found.", "NOT_FOUND");
    if (existing.role === "OWNER") throw new AppError("Owner accounts cannot be modified here.", "FORBIDDEN");
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { name: input.name, isActive: input.isActive },
      select,
    });
    const statusChanged = existing.isActive !== input.isActive;
    await recordAudit(tx, {
      action: statusChanged ? (input.isActive ? "USER_ENABLED" : "USER_DISABLED") : "USER_UPDATED",
      entityType: "User",
      entityId: updated.id,
      summary: statusChanged
        ? `${input.isActive ? "Enabled" : "Disabled"} manager ${updated.name}`
        : `Updated manager ${updated.name}`,
      actorId: actor.id,
    });
    return updated;
  });
  return toDTO(user);
}

export async function resetManagerPassword(input: { userId: string; password: string }, actor: SessionUser) {
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: input.userId } });
    if (!existing) throw new AppError("User not found.", "NOT_FOUND");
    if (existing.role === "OWNER" && existing.id !== actor.id) {
      throw new AppError("Owner accounts cannot be modified here.", "FORBIDDEN");
    }
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash } });
    await recordAudit(tx, {
      action: "USER_PASSWORD_RESET",
      entityType: "User",
      entityId: existing.id,
      summary: `Reset password for ${existing.name}`,
      actorId: actor.id,
    });
  });
}
