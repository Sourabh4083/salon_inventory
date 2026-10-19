import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBill, getSalesReport } from "@/lib/services/billing";
import { endOfDayInZone, zonedDate } from "@/lib/timezone";
import { billCreateSchema } from "@/lib/validation/schemas";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let manager: SessionUser;

beforeAll(async () => {
  manager = (await seedBasics()).manager;
});

describe("stored times", () => {
  it("every date column keeps its time zone", async () => {
    const naive = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND data_type = 'timestamp without time zone'
        AND table_name <> '_prisma_migrations'`;
    expect(naive).toEqual([]);
  });

  it("the database runs in UTC, so Prisma's offset-less timestamps mean what they say", async () => {
    const [{ TimeZone }] = await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`;
    expect(TimeZone).toBe("UTC");
    // Also the database default, for connections that skip db.ts's startup option.
    const [setting] = await prisma.$queryRaw<{ setconfig: string[] }[]>`
      SELECT setconfig FROM pg_db_role_setting
      WHERE setrole = 0 AND setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    expect(setting?.setconfig).toContain("TimeZone=UTC");
  });

  it("a bill made just after midnight in the salon is filed under that day", async () => {
    // 12:30 AM IST on 10 Mar 2025 is still 9 Mar in UTC.
    const at = zonedDate(2025, 3, 10, 0, 30);
    const bill = await createBill(
      billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Late Cut", quantity: 1, unitPrice: "250" }], paymentMethod: "CASH" }),
      manager,
    );
    await prisma.bill.update({ where: { id: bill.id }, data: { createdAt: at } });

    const stored = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id }, select: { createdAt: true } });
    expect(stored.createdAt.getTime()).toBe(at.getTime());
    const [wall] = await prisma.$queryRaw<{ local: string }[]>`
      SELECT to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS local FROM "Bill" WHERE id = ${bill.id}`;
    expect(wall.local).toBe("2025-03-10 00:30");

    const report = await getSalesReport({ from: zonedDate(2025, 3, 9), to: endOfDayInZone(zonedDate(2025, 3, 10)) });
    expect(report.byDay).toEqual([{ date: "2025-03-10", billCount: 1, amount: "250.00" }]);
  });
});
