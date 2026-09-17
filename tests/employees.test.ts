import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addEmployeeDocument,
  addSalaryPayment,
  createEmployee,
  deleteEmployeeDocument,
  deleteSalaryPayment,
  getEmployee,
  getEmployeeDocumentFile,
  listEmployees,
  setEmployeeActive,
  updateEmployee,
} from "@/lib/services/employees";
import { employeeSchema, salaryPaymentSchema } from "@/lib/validation/schemas";
import { EMPLOYEE_DOC_MAX_BYTES, EMPLOYEE_DOC_MAX_COUNT } from "@/lib/constants";
import { seedBasics } from "./helpers";
import type { SessionUser } from "@/lib/auth/session";

let owner: SessionUser;
let manager: SessionUser;

function input(overrides: Record<string, unknown> = {}) {
  return employeeSchema.parse({ name: "Priya Sharma", ...overrides });
}

const bytes = (n: number, fill = 7) => new Uint8Array(new ArrayBuffer(n)).fill(fill);

beforeAll(async () => {
  const s = await seedBasics();
  owner = s.owner;
  manager = s.manager;
});

describe("employee validation", () => {
  it("normalises phone, email and aadhaar; blanks become null", () => {
    const e = employeeSchema.parse({
      name: "  Ravi  ",
      phone: "+91 98765 43210",
      email: " Ravi@Example.COM ",
      aadhaarNumber: "1234 5678 9012",
      monthlySalary: "15,000",
      joinedAt: "2026-01-15",
      leftAt: "",
      designation: "",
    });
    expect(e.name).toBe("Ravi");
    expect(e.phone).toBe("919876543210");
    expect(e.email).toBe("ravi@example.com");
    expect(e.aadhaarNumber).toBe("123456789012");
    expect(e.monthlySalary).toBe("15000");
    expect(e.joinedAt?.getFullYear()).toBe(2026);
    expect(e.leftAt).toBeNull();
    expect(e.designation).toBeNull();
  });

  it("rejects a bad aadhaar number, phone, date and blank name", () => {
    expect(() => employeeSchema.parse({ name: "X", aadhaarNumber: "12345" })).toThrow(/12 digits/);
    expect(() => employeeSchema.parse({ name: "X", aadhaarNumber: "1234-5678-901A" })).toThrow(/12 digits/);
    expect(() => employeeSchema.parse({ name: "X", phone: "123" })).toThrow(/10 to 15 digits/);
    expect(() => employeeSchema.parse({ name: "X", joinedAt: "15/01/2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => employeeSchema.parse({ name: "   " })).toThrow(/required/i);
  });

  it("salary payment needs a positive amount and a valid month", () => {
    const ok = salaryPaymentSchema.parse({ employeeId: "e1", amount: "15000", paidOn: "2026-09-05", periodMonth: "2026-09" });
    expect(ok.amount).toBe("15000");
    expect(ok.paymentMethod).toBe("CASH");
    expect(() => salaryPaymentSchema.parse({ employeeId: "e1", amount: "0", paidOn: "2026-09-05" })).toThrow(/more than 0/);
    expect(() => salaryPaymentSchema.parse({ employeeId: "e1", amount: "", paidOn: "2026-09-05" })).toThrow(/Enter a price/);
    expect(() => salaryPaymentSchema.parse({ employeeId: "e1", amount: "10", paidOn: "2026-09-05", periodMonth: "2026-13" })).toThrow(/YYYY-MM/);
  });
});

describe("employee records (owner only)", () => {
  let employeeId = "";

  it("owner creates, lists and reads an employee with masked aadhaar", async () => {
    const e = await createEmployee(input({ designation: "Stylist", aadhaarNumber: "123456789012", monthlySalary: "18000", phone: "9876543210" }), owner);
    employeeId = e.id;
    expect(e.isActive).toBe(true);
    expect(e.aadhaarLast4).toBe("9012");
    expect(e.monthlySalary).toBe("18000");
    expect(e.documentCount).toBe(0);

    const list = await listEmployees({}, owner);
    expect(list.map((x) => x.name)).toContain("Priya Sharma");
    expect((await listEmployees({ q: "styl" }, owner)).map((x) => x.id)).toContain(e.id);
    expect((await listEmployees({ q: "98765" }, owner)).map((x) => x.id)).toContain(e.id);
    expect((await listEmployees({ q: "nobody" }, owner)).length).toBe(0);

    const detail = await getEmployee(e.id, owner);
    expect(detail?.employee.name).toBe("Priya Sharma");
    expect(detail?.paidThisYear).toBe("0.00");
    const audit = await prisma.auditLog.findFirst({ where: { action: "EMPLOYEE_CREATED", entityId: e.id } });
    expect(audit?.actorId).toBe(owner.id);
  });

  it("owner updates details and the audit log records changed fields", async () => {
    const u = await updateEmployee(employeeId, input({ designation: "Senior Stylist", monthlySalary: "20000", aadhaarNumber: "123456789012" }), owner);
    expect(u.designation).toBe("Senior Stylist");
    expect(u.monthlySalary).toBe("20000");
    const audit = await prisma.auditLog.findFirst({ where: { action: "EMPLOYEE_UPDATED", entityId: employeeId }, orderBy: { createdAt: "desc" } });
    expect(audit?.summary).toMatch(/designation/);
    expect(audit?.summary).toMatch(/monthlySalary/);
  });

  it("deactivating sets a leaving date and moves the employee to the inactive list", async () => {
    const off = await setEmployeeActive(employeeId, false, owner);
    expect(off.isActive).toBe(false);
    expect(off.leftAt).not.toBeNull();
    expect((await listEmployees({}, owner)).map((x) => x.id)).not.toContain(employeeId);
    expect((await listEmployees({ status: "inactive" }, owner)).map((x) => x.id)).toContain(employeeId);
    const on = await setEmployeeActive(employeeId, true, owner);
    expect(on.isActive).toBe(true);
    expect(on.leftAt).toBeNull();
  });

  it("manager is refused everywhere, even at the service layer", async () => {
    await expect(listEmployees({}, manager)).rejects.toThrow(/owner/i);
    await expect(getEmployee(employeeId, manager)).rejects.toThrow(/owner/i);
    await expect(createEmployee(input({ name: "Sneaky" }), manager)).rejects.toThrow(/owner/i);
    await expect(updateEmployee(employeeId, input(), manager)).rejects.toThrow(/owner/i);
    await expect(setEmployeeActive(employeeId, false, manager)).rejects.toThrow(/owner/i);
    await expect(addEmployeeDocument(employeeId, { kind: "OTHER", fileName: "x.png", mimeType: "image/png", bytes: bytes(10) }, manager)).rejects.toThrow(/owner/i);
    await expect(addSalaryPayment(salaryPaymentSchema.parse({ employeeId, amount: "10", paidOn: "2026-09-01" }), manager)).rejects.toThrow(/owner/i);
  });
});

describe("aadhaar documents", () => {
  let employeeId = "";

  beforeAll(async () => {
    employeeId = (await createEmployee(input({ name: "Doc Holder" }), owner)).id;
  });

  it("stores and returns the exact bytes, and counts documents", async () => {
    const data = bytes(2048, 42);
    const doc = await addEmployeeDocument(employeeId, { kind: "AADHAAR_FRONT", fileName: "aadhaar-front.jpg", mimeType: "image/jpeg", bytes: data }, owner);
    expect(doc.kind).toBe("AADHAAR_FRONT");
    expect(doc.sizeBytes).toBe(2048);
    expect(doc.url).toBe(`/api/employees/${employeeId}/documents/${doc.id}`);
    expect(doc.uploadedByName).toBe(owner.name);

    const file = await getEmployeeDocumentFile(employeeId, doc.id);
    expect(file?.mimeType).toBe("image/jpeg");
    expect(file?.fileName).toBe("aadhaar-front.jpg");
    expect(Buffer.from(file!.data).equals(Buffer.from(data))).toBe(true);
    // A document cannot be fetched through another employee's URL.
    expect(await getEmployeeDocumentFile("other-employee", doc.id)).toBeNull();

    const detail = await getEmployee(employeeId, owner);
    expect(detail?.documents).toHaveLength(1);
    expect(detail?.employee.documentCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain('"data"'); // bytes never leave through the DTO
  });

  it("rejects unsupported types, empty and oversized files", async () => {
    await expect(addEmployeeDocument(employeeId, { kind: "OTHER", fileName: "x.exe", mimeType: "application/x-msdownload", bytes: bytes(10) }, owner)).rejects.toThrow(/JPG, PNG, WebP image or a PDF/);
    await expect(addEmployeeDocument(employeeId, { kind: "OTHER", fileName: "empty.png", mimeType: "image/png", bytes: bytes(0) }, owner)).rejects.toThrow(/empty/);
    await expect(addEmployeeDocument(employeeId, { kind: "OTHER", fileName: "big.pdf", mimeType: "application/pdf", bytes: bytes(EMPLOYEE_DOC_MAX_BYTES + 1) }, owner)).rejects.toThrow(/too large/);
  });

  it("caps the number of documents and allows deleting one", async () => {
    const existing = (await getEmployee(employeeId, owner))!.documents.length;
    for (let i = existing; i < EMPLOYEE_DOC_MAX_COUNT; i++) {
      await addEmployeeDocument(employeeId, { kind: "OTHER", fileName: `doc-${i}.pdf`, mimeType: "application/pdf", bytes: bytes(100) }, owner);
    }
    await expect(addEmployeeDocument(employeeId, { kind: "OTHER", fileName: "one-too-many.pdf", mimeType: "application/pdf", bytes: bytes(100) }, owner)).rejects.toThrow(/at most/);
    const docs = (await getEmployee(employeeId, owner))!.documents;
    expect(docs).toHaveLength(EMPLOYEE_DOC_MAX_COUNT);
    await deleteEmployeeDocument(docs[0].id, owner);
    expect((await getEmployee(employeeId, owner))!.documents).toHaveLength(EMPLOYEE_DOC_MAX_COUNT - 1);
    expect(await getEmployeeDocumentFile(employeeId, docs[0].id)).toBeNull();
    await expect(deleteEmployeeDocument(docs[1].id, manager)).rejects.toThrow(/owner/i);
  });
});

describe("salary payments", () => {
  let employeeId = "";

  beforeAll(async () => {
    employeeId = (await createEmployee(input({ name: "Paid Person", monthlySalary: "12000" }), owner)).id;
  });

  it("records payments, totals the current year and lists newest first", async () => {
    const year = new Date().getFullYear();
    const a = await addSalaryPayment(salaryPaymentSchema.parse({ employeeId, amount: "12000", paidOn: `${year}-01-05`, periodMonth: `${year}-01`, paymentMethod: "UPI" }), owner);
    const b = await addSalaryPayment(salaryPaymentSchema.parse({ employeeId, amount: "500.50", paidOn: `${year}-02-05`, note: "Bonus" }), owner);
    await addSalaryPayment(salaryPaymentSchema.parse({ employeeId, amount: "999", paidOn: `${year - 1}-12-31` }), owner);
    expect(a.paymentMethod).toBe("UPI");
    expect(b.note).toBe("Bonus");
    expect(b.createdByName).toBe(owner.name);

    const detail = await getEmployee(employeeId, owner);
    expect(detail?.payments.map((p) => p.amount)).toEqual(["500.5", "12000", "999"]);
    expect(detail?.paidThisYear).toBe("12500.50");
    expect(detail?.lastPaidOn).toBe(b.paidOn);
    const audit = await prisma.auditLog.findFirst({ where: { action: "SALARY_PAYMENT_RECORDED", entityId: employeeId } });
    expect(audit?.summary).toMatch(/Paid salary/);
  });

  it("owner can remove a payment; manager cannot", async () => {
    const detail = await getEmployee(employeeId, owner);
    const bonus = detail!.payments.find((p) => p.note === "Bonus")!;
    await expect(deleteSalaryPayment(bonus.id, manager)).rejects.toThrow(/owner/i);
    await deleteSalaryPayment(bonus.id, owner);
    expect((await getEmployee(employeeId, owner))?.paidThisYear).toBe("12000.00");
    await expect(deleteSalaryPayment(bonus.id, owner)).rejects.toThrow(/not found/i);
  });

  it("deleting an employee row cascades documents and payments", async () => {
    await prisma.employee.delete({ where: { id: employeeId } });
    expect(await prisma.salaryPayment.count({ where: { employeeId } })).toBe(0);
  });
});
