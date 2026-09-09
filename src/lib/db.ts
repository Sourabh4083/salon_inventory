import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Serverless hosts (Vercel) run many isolated instances, each with its own pool.
 * Hosted Postgres poolers allow only a small number of clients in total (Supabase
 * session mode: 15), so keep each instance's pool tiny and drop idle connections fast.
 * Override with DB_POOL_MAX when running on a long-lived server.
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 5));

function createClient(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    max: POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  createClient(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/salon_inventory");

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { createClient as createPrismaClient };
export type Db = PrismaClient;
