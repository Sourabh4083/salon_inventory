import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { fromPaise, toPaise } from "@/lib/money";

/*
 * Customers are remembered from their past bills, matched by phone number (last 10
 * digits). Bills without a phone can't be told apart by name alone, so they are left out.
 */

export type CustomerSuggestionDTO = {
  phoneKey: string;
  name: string | null;
  phone: string;
  visits: number;
  lastVisit: string;
};

export type CustomerBillDTO = {
  id: string;
  billNumber: string;
  createdAt: string;
  total: string;
  balanceDue: string;
  items: string[];
};

export type CustomerHistoryDTO = {
  phoneKey: string;
  visits: number;
  lastVisit: string | null;
  owes: string;
  bills: CustomerBillDTO[];
};

const VISITED: Prisma.BillWhereInput = { status: "COMPLETED", customerPhoneKey: { not: null } };

/** Past customers whose name or phone matches what was typed, most recent first. */
export async function searchCustomers(query: string, limit = 6): Promise<CustomerSuggestionDTO[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const or: Prisma.BillWhereInput[] = [{ customerName: { contains: q, mode: "insensitive" } }];
  if (digits.length >= 3) or.push({ customerPhoneKey: { contains: digits.slice(-10) } });

  const rows = await prisma.bill.findMany({
    where: { ...VISITED, OR: or },
    orderBy: { createdAt: "desc" },
    select: { customerName: true, customerPhone: true, customerPhoneKey: true },
    take: 200,
  });
  // The newest bill gives the name and number as last written.
  const latest = new Map<string, { name: string | null; phone: string }>();
  for (const r of rows) {
    if (!latest.has(r.customerPhoneKey!) && latest.size < limit) latest.set(r.customerPhoneKey!, { name: r.customerName, phone: r.customerPhone ?? r.customerPhoneKey! });
  }
  if (!latest.size) return [];

  const stats = await prisma.bill.groupBy({
    by: ["customerPhoneKey"],
    where: { ...VISITED, customerPhoneKey: { in: [...latest.keys()] } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const byKey = new Map(stats.map((s) => [s.customerPhoneKey!, s]));
  return [...latest].map(([key, c]) => ({
    phoneKey: key,
    name: c.name,
    phone: c.phone,
    visits: byKey.get(key)?._count._all ?? 0,
    lastVisit: (byKey.get(key)?._max.createdAt ?? new Date()).toISOString(),
  }));
}

/** How often a customer has come, what they still owe, and their latest bills. */
export async function getCustomerHistory(phoneKey: string, recent = 5): Promise<CustomerHistoryDTO> {
  const where: Prisma.BillWhereInput = { status: "COMPLETED", customerPhoneKey: phoneKey };
  const [agg, bills] = await Promise.all([
    prisma.bill.aggregate({ where, _count: { _all: true }, _max: { createdAt: true }, _sum: { balanceDue: true } }),
    prisma.bill.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: recent,
      select: { id: true, billNumber: true, createdAt: true, total: true, balanceDue: true, items: { orderBy: { sortOrder: "asc" }, select: { name: true } } },
    }),
  ]);
  return {
    phoneKey,
    visits: agg._count._all,
    lastVisit: agg._max.createdAt?.toISOString() ?? null,
    owes: fromPaise(toPaise(agg._sum.balanceDue?.toString() ?? "0")),
    bills: bills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      createdAt: b.createdAt.toISOString(),
      total: b.total.toFixed(2),
      balanceDue: b.balanceDue.toFixed(2),
      items: b.items.map((i) => i.name),
    })),
  };
}
