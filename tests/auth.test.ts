import { beforeAll, describe, expect, it } from "vitest";
import { authenticate, createManager, updateManager, resetManagerPassword } from "@/lib/services/users";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { seedBasics, OWNER_PASSWORD, MANAGER_PASSWORD } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;

beforeAll(async () => {
  ({ owner } = await seedBasics());
});

describe("passwords", () => {
  it("hashes with argon2 and never stores plain text", async () => {
    const hash = await hashPassword("Secret123!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("Secret123!");
    expect(await verifyPassword(hash, "Secret123!")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});

describe("login", () => {
  it("owner can sign in with correct credentials", async () => {
    const user = await authenticate("owner@test.local", OWNER_PASSWORD);
    expect(user?.role).toBe("OWNER");
  });

  it("manager can sign in with correct credentials (email is case-insensitive)", async () => {
    const user = await authenticate("Manager@Test.local", MANAGER_PASSWORD);
    expect(user?.role).toBe("MANAGER");
  });

  it("rejects a wrong password and unknown email", async () => {
    expect(await authenticate("owner@test.local", "nope")).toBeNull();
    expect(await authenticate("ghost@test.local", OWNER_PASSWORD)).toBeNull();
  });
});

describe("owner manages managers", () => {
  it("creates a manager, disables them, and they can no longer sign in", async () => {
    const created = await createManager({ name: "New Manager", email: "new.manager@test.local", password: "Temp#Pass123" }, owner);
    expect(created.role).toBe("MANAGER");
    expect((await authenticate("new.manager@test.local", "Temp#Pass123"))?.id).toBe(created.id);

    await updateManager({ userId: created.id, name: "New Manager", isActive: false }, owner);
    await expect(authenticate("new.manager@test.local", "Temp#Pass123")).rejects.toThrow(/disabled/i);

    const audit = await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["USER_CREATED", "USER_DISABLED"]));
  });

  it("rejects duplicate emails", async () => {
    await expect(createManager({ name: "Dup", email: "manager@test.local", password: "Temp#Pass123" }, owner)).rejects.toThrow(/already exists/i);
  });

  it("resets a manager password", async () => {
    const m = await createManager({ name: "Reset Me", email: "reset@test.local", password: "OldPass#123" }, owner);
    await resetManagerPassword({ userId: m.id, password: "NewPass#456" }, owner);
    expect(await authenticate("reset@test.local", "OldPass#123")).toBeNull();
    expect((await authenticate("reset@test.local", "NewPass#456"))?.id).toBe(m.id);
  });

  it("cannot modify the owner account through manager management", async () => {
    await expect(updateManager({ userId: owner.id, name: "Hacked", isActive: false }, owner)).rejects.toThrow(/owner/i);
  });
});
