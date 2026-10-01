import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/generated/prisma/enums";

/** Wipes all tables (order matters because of foreign keys) and resets the number sequences. */
export async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.enquiryCall.deleteMany();
  await prisma.enquiry.deleteMany();
  await prisma.salaryPayment.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.employeeAdvance.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.employeeDocument.deleteMany();
  await prisma.openBill.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.billItem.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.service.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.businessSettings.deleteMany();
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "product_number_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "bill_number_seq" RESTART WITH 1`);
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "order_number_seq" RESTART WITH 1`);
}

export const OWNER_PASSWORD = "Owner@Test1234";
export const MANAGER_PASSWORD = "Manager@Test1234";

export async function createUser(role: Role, overrides: Partial<{ name: string; email: string; password: string; isActive: boolean }> = {}): Promise<SessionUser> {
  const email = overrides.email ?? (role === "OWNER" ? "owner@test.local" : `manager-${Math.random().toString(36).slice(2, 8)}@test.local`);
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? (role === "OWNER" ? "Test Owner" : "Test Manager"),
      email,
      passwordHash: await hashPassword(overrides.password ?? (role === "OWNER" ? OWNER_PASSWORD : MANAGER_PASSWORD)),
      role,
      isActive: overrides.isActive ?? true,
    },
  });
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function createCategoryRow(name = "Glue") {
  return prisma.category.upsert({ where: { name }, update: {}, create: { name } });
}

export async function seedBasics() {
  await resetDatabase();
  const owner = await createUser("OWNER");
  const manager = await createUser("MANAGER", { email: "manager@test.local" });
  const category = await createCategoryRow("Glue");
  await prisma.businessSettings.create({ data: { id: "default", lowStockThreshold: 4 } });
  return { owner, manager, category };
}
