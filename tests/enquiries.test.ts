import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addNumbers, callsTabCounts, listEnquiries, logCall, markVisited, updateEnquiry } from "@/lib/services/enquiries";
import { createBill } from "@/lib/services/billing";
import { addNumbersSchema, billCreateSchema, callLogSchema, enquiryEditSchema, splitPhoneNumbers } from "@/lib/validation/schemas";
import { toDateParam } from "@/lib/dates";
import { addDaysInZone, startOfDayInZone } from "@/lib/timezone";
import { phoneKey } from "@/lib/phone";
import { can } from "@/lib/permissions";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;

beforeEach(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
});

const today = () => startOfDayInZone(new Date());
const day = (offset: number) => toDateParam(addDaysInZone(today(), offset));

async function add(text: string, actor = manager) {
  return addNumbers(addNumbersSchema.parse({ numbers: text }), actor);
}

async function idOf(phone: string) {
  return (await prisma.enquiry.findFirstOrThrow({ where: { phoneKey: phoneKey(phone)! }, orderBy: { createdAt: "desc" } })).id;
}

async function tabIds(tab: "today" | "coming" | "later" | "closed") {
  return (await listEnquiries({ tab }, manager)).items.map((e) => e.phone);
}

describe("permissions", () => {
  it("both manager and owner can work the call list", () => {
    expect(can("MANAGER", "enquiry.manage")).toBe(true);
    expect(can("OWNER", "enquiry.manage")).toBe(true);
  });
});

describe("adding numbers", () => {
  it("splits pasted text on lines, commas and spaces, keeping spaced-out numbers together", () => {
    expect(splitPhoneNumbers("+91 98765 43210\n9123456789, 9000000001 9000000002\nName: Ravi 9811111111\n12345")).toEqual({
      numbers: ["+91 98765 43210", "9123456789", "9000000001", "9000000002", "9811111111"],
      invalid: ["12345"],
    });
    expect(addNumbersSchema.safeParse({ numbers: "   " }).success).toBe(false);
  });

  it("adds new numbers and skips ones already open, in any format or repeated in the paste", async () => {
    const first = await add("9876543210");
    expect(first).toEqual({ added: 1, duplicates: [], invalid: [] });

    const second = await add("+91 98765-43210\n9123456789\n09123456789\n123");
    expect(second.added).toBe(1);
    expect(second.duplicates.sort()).toEqual(["+91 98765-43210", "09123456789"].sort());
    expect(second.invalid).toEqual(["123"]);

    const rows = await prisma.enquiry.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "NEW" && r.name === null && r.createdById === manager.id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "ENQUIRIES_ADDED" } })).toBe(2);
  });

  it("allows a number again once its old enquiry is closed", async () => {
    await add("9876543210");
    await logCall(callLogSchema.parse({ enquiryId: await idOf("9876543210"), result: "NOT_INTERESTED" }), manager);
    expect((await add("9876543210")).added).toBe(1);
  });
});

describe("logging calls", () => {
  it("coming needs a day; saves name, note and status", async () => {
    await add("9876543210");
    const id = await idOf("9876543210");
    expect(callLogSchema.safeParse({ enquiryId: id, result: "COMING" }).success).toBe(false);
    expect(callLogSchema.safeParse({ enquiryId: id, result: "CALL_BACK" }).success).toBe(false);

    const e = await logCall(callLogSchema.parse({ enquiryId: id, result: "COMING", date: day(2), name: "Priya", interest: "Hair colour", note: "Evening" }), manager);
    expect(e.status).toBe("COMING");
    expect(toDateParam(new Date(e.comingOn!))).toBe(day(2));
    expect(e.nextCallOn).toBeNull();
    expect(e.name).toBe("Priya");
    expect(e.interest).toBe("Hair colour");
    expect(e.calls).toHaveLength(1);
    expect(e.calls[0]).toMatchObject({ result: "COMING", note: "Evening", calledByName: "Test Manager" });
    expect(await prisma.auditLog.count({ where: { action: "ENQUIRY_CALL_LOGGED", entityId: id } })).toBe(1);
  });

  it("no answer means try again tomorrow; call back uses the picked day", async () => {
    await add("9876543210, 9123456789");
    const a = await logCall(callLogSchema.parse({ enquiryId: await idOf("9876543210"), result: "NO_ANSWER", date: day(5) }), manager);
    expect(a.status).toBe("NO_ANSWER");
    expect(toDateParam(new Date(a.nextCallOn!))).toBe(day(1));
    const b = await logCall(callLogSchema.parse({ enquiryId: await idOf("9123456789"), result: "CALL_BACK", date: day(3) }), manager);
    expect(toDateParam(new Date(b.nextCallOn!))).toBe(day(3));
  });

  it("rejects past dates and calls on closed enquiries", async () => {
    await add("9876543210");
    const id = await idOf("9876543210");
    await expect(logCall(callLogSchema.parse({ enquiryId: id, result: "COMING", date: day(-1) }), manager)).rejects.toThrow(/past/i);
    await logCall(callLogSchema.parse({ enquiryId: id, result: "NOT_INTERESTED" }), manager);
    await expect(logCall(callLogSchema.parse({ enquiryId: id, result: "NO_ANSWER" }), manager)).rejects.toThrow(/closed/i);
  });

  it("editing refuses a number that is already open elsewhere", async () => {
    await add("9876543210, 9123456789");
    const id = await idOf("9123456789");
    await expect(updateEnquiry(id, enquiryEditSchema.parse({ phone: "+91 98765 43210" }), manager)).rejects.toThrow(/already/i);
    const e = await updateEnquiry(id, enquiryEditSchema.parse({ phone: "9000000001", name: "Asha" }), owner);
    expect(e).toMatchObject({ phone: "9000000001", name: "Asha" });
  });
});

describe("lists", () => {
  it("today shows new numbers, due follow-ups and missed visits; others go to their tabs", async () => {
    await add("9000000001\n9000000002\n9000000003\n9000000004\n9000000005\n9000000006\n9000000007");
    const id = (p: string) => idOf(p);
    // due today (call back), overdue (no answer from days ago), future call back
    await prisma.enquiry.update({ where: { id: await id("9000000002") }, data: { status: "CALL_BACK", nextCallOn: today() } });
    await prisma.enquiry.update({ where: { id: await id("9000000003") }, data: { status: "NO_ANSWER", nextCallOn: addDaysInZone(today(), -3) } });
    await prisma.enquiry.update({ where: { id: await id("9000000004") }, data: { status: "CALL_BACK", nextCallOn: addDaysInZone(today(), 2) } });
    // said coming yesterday but did not visit; coming today
    await prisma.enquiry.update({ where: { id: await id("9000000005") }, data: { status: "COMING", comingOn: addDaysInZone(today(), -1) } });
    await prisma.enquiry.update({ where: { id: await id("9000000006") }, data: { status: "COMING", comingOn: today() } });
    await prisma.enquiry.update({ where: { id: await id("9000000007") }, data: { status: "NOT_INTERESTED" } });

    // New first, then the longest-overdue follow-ups.
    expect(await tabIds("today")).toEqual(["9000000001", "9000000003", "9000000005", "9000000002"]);
    expect(await tabIds("coming")).toEqual(["9000000006"]);
    expect(await tabIds("later")).toEqual(["9000000004"]);
    expect(await tabIds("closed")).toEqual(["9000000007"]);
    expect(await callsTabCounts(manager)).toEqual({ today: 4, coming: 1, later: 1, closed: 1 });
  });

  it("searches by name or any part of the number", async () => {
    await add("9876543210, 9123456789");
    await logCall(callLogSchema.parse({ enquiryId: await idOf("9123456789"), result: "NO_ANSWER", name: "Meena" }), manager);
    await prisma.enquiry.updateMany({ data: { nextCallOn: today() } });
    expect((await listEnquiries({ tab: "today", search: "meena" }, manager)).items.map((e) => e.phone)).toEqual(["9123456789"]);
    expect((await listEnquiries({ tab: "today", search: "+91 98765" }, manager)).items.map((e) => e.phone)).toEqual(["9876543210"]);
  });
});

describe("auto-close when the customer visits", () => {
  const bill = (phone: string | undefined, actor: SessionUser) =>
    createBill(billCreateSchema.parse({ items: [{ kind: "SERVICE", name: "Haircut", quantity: 1, unitPrice: "300" }], customerName: "Priya S", customerPhone: phone }), actor);

  it("a bill with the same number marks the enquiry visited and links the bill", async () => {
    await add("9876543210");
    const id = await idOf("9876543210");
    await logCall(callLogSchema.parse({ enquiryId: id, result: "COMING", date: day(0) }), manager);

    const b = await bill("+91 98765 43210", manager);
    const [e] = (await listEnquiries({ tab: "closed" }, manager)).items;
    expect(e).toMatchObject({ id, status: "VISITED", visitedBillId: b.id, visitedBillNumber: b.billNumber, name: "Priya S" });
    expect(await prisma.auditLog.count({ where: { action: "ENQUIRY_VISITED", entityId: id } })).toBe(1);
  });

  it("the manager can mark a visit by hand when the bill had no number", async () => {
    await add("9876543210");
    const id = await idOf("9876543210");
    await logCall(callLogSchema.parse({ enquiryId: id, result: "COMING", date: day(0), name: "Ravi" }), manager);
    const e = await markVisited(id, manager);
    expect(e).toMatchObject({ status: "VISITED", visitedBillId: null });
    expect(e.visitedAt).not.toBeNull();
    expect(await tabIds("closed")).toEqual(["9876543210"]);
    expect(await prisma.auditLog.count({ where: { action: "ENQUIRY_VISITED", entityId: id } })).toBe(1);
    await expect(markVisited(id, manager)).rejects.toThrow(/closed/i);
  });

  it("bills for other numbers, or with no number, leave enquiries alone", async () => {
    await add("9876543210");
    await bill("9123456789", owner);
    await bill(undefined, owner);
    expect((await prisma.enquiry.findFirstOrThrow()).status).toBe("NEW");
  });
});
