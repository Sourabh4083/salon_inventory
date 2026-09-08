/**
 * Runs once before the test suite: applies migrations to the dedicated test database.
 */
import "dotenv/config";
import { execSync } from "node:child_process";

export function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/salon_inventory";
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  return url.toString();
}

export default async function globalSetup() {
  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
