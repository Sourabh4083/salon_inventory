/**
 * HTTP-level route protection tests against a running dev/prod server (default http://localhost:3000)
 * using the seeded development database (`npm run db:seed`).
 *
 * Run with: npm run test:http
 */
import "dotenv/config";
import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const COOKIE = "salon_session";

async function tokenFor(userId: string, role: "OWNER" | "MANAGER") {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
}

async function get(path: string, cookie?: string) {
  return fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
}

let ownerToken: string;
let managerToken: string;
let managerUserId = "";
const managerId = async () => managerUserId;

beforeAll(async () => {
  const health = await fetch(`${BASE}/login`, { redirect: "manual" }).catch(() => null);
  if (!health) throw new Error(`Server not reachable at ${BASE}. Start it with "npm run dev" first.`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: "owner@salon.local" } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@salon.local" } });
  await prisma.$disconnect();
  managerUserId = manager.id;
  ownerToken = await tokenFor(owner.id, "OWNER");
  managerToken = await tokenFor(manager.id, "MANAGER");
});

describe("route protection", () => {
  it("login page is public", async () => {
    const res = await get("/login");
    expect(res.status).toBe(200);
  });

  it.each(["/dashboard", "/inventory", "/inventory/low-stock", "/activity", "/users", "/settings"])(
    "anonymous visitor to %s is redirected to /login",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    },
  );

  it("a forged / invalid session cookie is rejected", async () => {
    const res = await get("/dashboard", "not-a-real-token");
    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("owner can open dashboard, users, settings, reports, activity, pricing and employees", async () => {
    for (const path of ["/dashboard", "/users", "/settings", "/reports", "/activity", "/pricing", "/employees"]) {
      const res = await get(path, ownerToken);
      expect(res.status, path).toBe(200);
    }
  });

  it("manager can open dashboard and inventory but NOT owner-only pages", async () => {
    for (const path of ["/dashboard", "/inventory", "/billing/new"]) {
      const res = await get(path, managerToken);
      expect(res.status, path).toBe(200);
    }
    for (const path of ["/users", "/settings", "/reports", "/activity", "/pricing", "/employees", "/employees/new"]) {
      const res = await get(path, managerToken);
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location")).toContain("/dashboard?denied=1");
    }
  });

  it("employee documents are owner-only at the API level", async () => {
    const path = "/api/employees/some-id/documents/some-doc";
    const anon = await get(path);
    expect(anon.status).toBe(307); // proxy sends anonymous visitors to /login
    const manager = await get(path, managerToken);
    expect(manager.status).toBe(403);
    const owner = await get(path, ownerToken);
    expect(owner.status).toBe(404); // authorised, but no such document
  });

  it("a token whose role claim was tampered to OWNER is still blocked by the page-level database check", async () => {
    const forged = await tokenFor((await managerId()), "OWNER");
    const res = await get("/users", forged);
    // proxy lets it through (role hint), but the page re-checks the DB and redirects
    const body = await res.text();
    expect(res.status === 307 || body.includes("/dashboard?denied=1")).toBe(true);
    expect(body).not.toContain("Add Manager");
  });

  it("signed-in users are redirected away from /login", async () => {
    const res = await get("/login", ownerToken);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });
});
