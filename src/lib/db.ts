import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  createClient(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/salon_inventory");

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { createClient as createPrismaClient };
export type Db = PrismaClient;
