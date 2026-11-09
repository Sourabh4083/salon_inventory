import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, setCategoryNeedsService } from "@/lib/services/products";
import { cancelBill, createBill, getBill, updateBill } from "@/lib/services/billing";
import { getBillReminderNote } from "@/lib/services/service-reminders";
import { addNumbers, getCalledLead, listEnquiries, logCall, rollOverDueReplacements } from "@/lib/services/enquiries";
import { addNumbersSchema, billCreateSchema, billUpdateSchema, callLogSchema, productCreateSchema } from "@/lib/validation/schemas";
import { addDaysInZone, addMonthsInZone, startOfDayInZone, zonedDate, zonedParts } from "@/lib/timezone";
import { toDateParam } from "@/lib/dates";
import { createCategoryRow, seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;
let wigId: string;
let glueId: string;

const PHONE = "98765 43210";
const KEY = "9876543210";

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
  const wigs = await createCategoryRow("Wig");
  await setCategoryNeedsService(wigs.id, true, owner);
  wigId = (await createProduct(productCreateSchema.parse({ name: "Lace Wig", categoryId: wigs.id, startingQuantity: 20, sellingPrice: "9000" }), owner)).id;
  glueId = (await createProduct(productCreateSchema.parse({ name: "Glue", categoryId: s.category.id, startingQuantity: 50, sellingPrice: "300" }), owner)).id;
});

function sell(items: { productId: string; quantity?: number }[], phone: string | undefined = PHONE, name = "Priya") {
  return createBill(
    billCreateSchema.parse({ items: items.map((i) => ({ kind: "PRODUCT", productId: i.productId, quantity: i.quantity ?? 1, unitPrice: "100" })), customerName: name, customerPhone: phone }),
    manager,
  );
}

/** Pretends `days` have passed: every bill and reminder date moves back. */
async function passDays(days: number) {
  await prisma.$executeRawUnsafe(`UPDATE "Bill" SET "createdAt" = "createdAt" - interval '${days} days'`);
  await prisma.$executeRawUnsafe(
    `UPDATE "Enquiry" SET "cycleStart" = "cycleStart" - interval '${days} days', "nextCallOn" = "nextCallOn" - interval '${days} days', "visitedAt" = "visitedAt" - interval '${days} days'`,
  );
}

const reminders = (where: object = {}) => prisma.enquiry.findMany({ where: { kind: { in: ["SERVICE", "REPLACE"] }, ...where }, orderBy: [{ createdAt: "asc" }, { kind: "asc" }] });
const open = (kind: "SERVICE" | "REPLACE") => prisma.enquiry.findMany({ where: { kind, status: { in: ["NEW", "NO_ANSWER", "CALL_BACK", "COMING"] } } });

function localInput(d: Date) {
  const p = zonedParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

async function edit(billId: string, changes: { items?: { productId: string }[]; customerPhone?: string; billedAt?: Date }) {
  const bill = (await getBill(billId))!;
  return updateBill(
    billUpdateSchema.parse({
      billId,
      billedAt: localInput(changes.billedAt ?? new Date(bill.createdAt)),
      items: (changes.items ?? bill.items.map((i) => ({ productId: i.productId! }))).map((i) => ({ kind: "PRODUCT", productId: i.productId, quantity: 1, unitPrice: "100" })),
      customerName: bill.customerName ?? undefined,
      customerPhone: "customerPhone" in changes ? changes.customerPhone : (bill.customerPhone ?? undefined),
      paymentMethod: "CASH",
    }),
    owner,
  );
}

describe("selling a product that needs servicing", () => {
  it("adds one card: servicing due in 25 days, showing the replacement date 7 months on", async () => {
    const bill = await sell([{ productId: wigId }, { productId: glueId }]);
    const sold = new Date(bill.createdAt);
    expect(await reminders()).toHaveLength(1);
    const [svc] = await open("SERVICE");

    expect(svc).toMatchObject({ phoneKey: KEY, name: "Priya", interest: "Lace Wig", status: "CALL_BACK", sourceBillId: bill.id });
    expect(svc.nextCallOn).toEqual(addDaysInZone(sold, 25));
    expect(svc.cycleStart).toEqual(sold);

    const later = (await listEnquiries({ tab: "later" }, manager)).items;
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({
      kind: "SERVICE",
      sourceBillId: bill.id,
      sourceBillNumber: bill.billNumber,
      boughtAt: bill.createdAt,
      serviceOn: addDaysInZone(sold, 25).toISOString(),
      replaceOn: addMonthsInZone(sold, 7).toISOString(),
      lastServiceAt: null,
    });
  });

  it("the card turns into a replacement card when the replacement date comes", async () => {
    const bill = await sell([{ productId: wigId }]);
    await passDays(150);
    expect(await rollOverDueReplacements()).toBe(0);
    await passDays(70); // about 7 months and a week
    expect(await rollOverDueReplacements()).toBe(1);

    expect(await open("SERVICE")).toHaveLength(0);
    const [rep] = await open("REPLACE");
    const bought = new Date((await getBill(bill.id))!.createdAt);
    expect(rep.nextCallOn).toEqual(addMonthsInZone(bought, 7));
    const today = (await listEnquiries({ tab: "today" }, manager)).items;
    expect(today).toMatchObject([{ kind: "REPLACE", serviceOn: null, replaceOn: addMonthsInZone(bought, 7).toISOString() }]);
  });

  it("keeps a later call-back day the staff picked when it turns into a replacement card", async () => {
    await sell([{ productId: wigId }]);
    await passDays(200);
    const [svc] = await open("SERVICE");
    const callBack = addDaysInZone(startOfDayInZone(new Date()), 20);
    await logCall(callLogSchema.parse({ enquiryId: svc.id, result: "CALL_BACK", date: toDateParam(callBack) }), manager);
    expect(await rollOverDueReplacements(addDaysInZone(new Date(), 15))).toBe(1);
    expect((await open("REPLACE"))[0].nextCallOn).toEqual(callBack);
  });

  it("adds nothing without a mobile number or for products that do not need servicing", async () => {
    await sell([{ productId: wigId }], "");
    await sell([{ productId: glueId }]);
    expect(await reminders()).toHaveLength(0);
  });

  it("follows the category switch in Settings", async () => {
    const wigs = await prisma.category.findUniqueOrThrow({ where: { name: "Wig" } });
    await setCategoryNeedsService(wigs.id, false, owner);
    await sell([{ productId: wigId }]);
    expect(await reminders()).toHaveLength(0);
  });

  it("shows up in To call today when servicing is due", async () => {
    await sell([{ productId: wigId }]);
    await passDays(25);
    const today = (await listEnquiries({ tab: "today" }, manager)).items;
    expect(today.map((e) => e.kind)).toEqual(["SERVICE"]);
    expect((await listEnquiries({ tab: "later" }, manager)).items).toHaveLength(0);
  });
});

describe("coming back", () => {
  it("a visit soon after buying is not servicing; one after 15+ days is, and the next one is set", async () => {
    await sell([{ productId: wigId }]);
    await passDays(5);
    await sell([{ productId: glueId }]);
    expect(await open("SERVICE")).toHaveLength(1);
    expect((await open("SERVICE"))[0].status).toBe("CALL_BACK");

    await passDays(15); // 20 days after buying
    const visit = await sell([{ productId: glueId }]);
    const [first, next] = await reminders({ kind: "SERVICE" });
    expect(first).toMatchObject({ status: "VISITED", visitedBillId: visit.id });
    expect(next).toMatchObject({ status: "CALL_BACK", sourceBillId: first.sourceBillId, interest: "Lace Wig" });
    expect(next.nextCallOn).toEqual(addDaysInZone(new Date(visit.createdAt), 25));
    expect(next.cycleStart).toEqual(new Date(visit.createdAt));
    expect(await open("REPLACE")).toHaveLength(0);
  });

  it("the next card is for the replacement once the next servicing would fall after it", async () => {
    const sale = await sell([{ productId: wigId }]);
    await passDays(195); // about 6.5 months
    const visit = await sell([{ productId: glueId }]);
    expect(await open("SERVICE")).toHaveLength(0);
    expect((await reminders({ kind: "SERVICE" }))[0].status).toBe("VISITED");
    const [rep] = await open("REPLACE");
    expect(rep.nextCallOn).toEqual(addMonthsInZone(new Date((await getBill(sale.id))!.createdAt), 7));
    const [card] = (await listEnquiries({ tab: "later" }, manager)).items;
    expect(card).toMatchObject({ kind: "REPLACE", lastServiceAt: visit.createdAt });
  });

  it("buying a new one closes the old reminders and starts again", async () => {
    await sell([{ productId: wigId }]);
    await passDays(200);
    const second = await sell([{ productId: wigId }]);
    const all = await reminders();
    expect(all.filter((r) => r.sourceBillId !== second.id).every((r) => r.status === "VISITED" && r.visitedBillId === second.id)).toBe(true);
    expect((await open("SERVICE")).map((r) => r.sourceBillId)).toEqual([second.id]);
    expect(await open("REPLACE")).toHaveLength(0);
  });

  it("one bill can close a new-customer lead and a servicing call together", async () => {
    await sell([{ productId: wigId }]);
    await passDays(20);
    await addNumbers(addNumbersSchema.parse({ numbers: PHONE }), manager);
    expect(await getCalledLead(KEY)).not.toBeNull(); // the lead, not the reminder
    const visit = await sell([{ productId: glueId }]);
    const closed = await prisma.enquiry.findMany({ where: { visitedBillId: visit.id } });
    expect(closed.map((e) => e.kind).sort()).toEqual(["LEAD", "SERVICE"]);
  });

  it("a reminder alone is not shown as 'came after our call'", async () => {
    await sell([{ productId: wigId }]);
    expect(await getCalledLead(KEY)).toBeNull();
  });
});

describe("cancelling and editing the bill", () => {
  it("cancelling the bill removes its open reminders", async () => {
    const bill = await sell([{ productId: wigId }]);
    await cancelBill({ billId: bill.id, reason: "Mistake" }, owner);
    expect(await reminders()).toHaveLength(0);
  });

  it("removing the product removes the reminders; adding one to an old bill starts them from its date", async () => {
    const bill = await sell([{ productId: wigId }, { productId: glueId }]);
    await edit(bill.id, { items: [{ productId: glueId }] });
    expect(await reminders()).toHaveLength(0);

    const plain = await sell([{ productId: glueId }], "91234 56789", "Ravi");
    await edit(plain.id, { items: [{ productId: glueId }, { productId: wigId }] });
    const [svc] = await open("SERVICE");
    expect(svc).toMatchObject({ phoneKey: "9123456789", sourceBillId: plain.id });
    expect(svc.nextCallOn).toEqual(addDaysInZone(new Date((await getBill(plain.id))!.createdAt), 25));
  });

  it("changing the date moves the due date, except a date the staff picked on a call", async () => {
    const bill = await sell([{ productId: wigId }]);
    const p = zonedParts(new Date(bill.createdAt));
    const earlier = zonedDate(p.year, p.month, p.day - 10, 11, 0);
    await edit(bill.id, { billedAt: earlier });
    let [svc] = await open("SERVICE");
    expect(svc.nextCallOn).toEqual(addDaysInZone(earlier, 25));
    expect(svc.cycleStart).toEqual(earlier);

    const callBack = addDaysInZone(startOfDayInZone(new Date()), 3);
    await logCall(callLogSchema.parse({ enquiryId: svc.id, result: "CALL_BACK", date: toDateParam(callBack) }), manager);
    const evenEarlier = zonedDate(p.year, p.month, p.day - 12, 11, 0);
    await edit(bill.id, { billedAt: evenEarlier });
    [svc] = await open("SERVICE");
    expect(svc.cycleStart).toEqual(evenEarlier);
    expect(svc.nextCallOn).toEqual(callBack);
  });

  it("changing the mobile moves the reminders; removing it removes them", async () => {
    const bill = await sell([{ productId: wigId }]);
    await edit(bill.id, { customerPhone: "+91 90000 11111" });
    expect((await reminders()).map((r) => r.phoneKey)).toEqual(["9000011111"]);
    await edit(bill.id, { customerPhone: undefined });
    expect(await reminders()).toHaveLength(0);
  });
});

describe("turning a category off", () => {
  it("removes calls nobody has made yet for bills with only that category, keeps the rest", async () => {
    const gels = await createCategoryRow("Hair System");
    await setCategoryNeedsService(gels.id, true, owner);
    const gelId = (await createProduct(productCreateSchema.parse({ name: "Hair Gel", categoryId: gels.id, startingQuantity: 20, sellingPrice: "200" }), owner)).id;

    const gelOnly = await sell([{ productId: gelId }], "91111 11111", "Gel buyer");
    const called = await sell([{ productId: gelId }], "92222 22222", "Talked to");
    const both = await sell([{ productId: wigId }, { productId: gelId }], "93333 33333", "Wig and gel");
    const svc = await prisma.enquiry.findFirstOrThrow({ where: { sourceBillId: called.id, kind: "SERVICE" } });
    await logCall(callLogSchema.parse({ enquiryId: svc.id, result: "NO_ANSWER" }), manager);

    const res = await setCategoryNeedsService(gels.id, false, owner);
    expect(res.removedCalls).toBe(1); // the gel-only bill's card; the called customer's card stays
    expect(await prisma.enquiry.count({ where: { sourceBillId: gelOnly.id } })).toBe(0);
    expect((await prisma.enquiry.findMany({ where: { sourceBillId: called.id } })).map((e) => e.kind)).toEqual(["SERVICE"]);
    const kept = await prisma.enquiry.findMany({ where: { sourceBillId: both.id } });
    expect(kept.map((e) => e.interest)).toEqual(["Lace Wig"]);
  });
});

describe("note after saving a bill", () => {
  it("says when the servicing and replacement calls are, and when a visit counts as servicing", async () => {
    const sale = await sell([{ productId: wigId }]);
    const note = await getBillReminderNote(sale.id);
    expect(note).toEqual({ serviceOn: addDaysInZone(new Date(sale.createdAt), 25).toISOString(), replaceOn: addMonthsInZone(new Date(sale.createdAt), 7).toISOString(), countedAsService: false });

    await passDays(20);
    const visit = await sell([{ productId: glueId }]);
    expect(await getBillReminderNote(visit.id)).toEqual({ serviceOn: addDaysInZone(new Date(visit.createdAt), 25).toISOString(), replaceOn: null, countedAsService: true });

    expect(await getBillReminderNote((await sell([{ productId: glueId }], "", "Walk-in")).id)).toBeNull();
  });
});

describe("dates", () => {
  it("adds months without spilling into the next month", () => {
    const jan31 = zonedDate(2027, 1, 31, 15, 0);
    expect(zonedParts(addMonthsInZone(jan31, 1))).toMatchObject({ year: 2027, month: 2, day: 28, hour: 0 });
    expect(zonedParts(addMonthsInZone(zonedDate(2026, 11, 7), 7))).toMatchObject({ year: 2027, month: 6, day: 7 });
  });
});
