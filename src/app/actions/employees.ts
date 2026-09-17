"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/guards";
import { toActionError, type ActionResult } from "@/lib/errors";
import { employeeDocumentKindSchema, employeeSchema, fieldErrors, salaryPaymentSchema, type EmployeeInput, type SalaryPaymentInput } from "@/lib/validation/schemas";
import {
  addEmployeeDocument,
  addSalaryPayment,
  createEmployee,
  deleteEmployeeDocument,
  deleteSalaryPayment,
  setEmployeeActive,
  updateEmployee,
  type EmployeeDTO,
  type EmployeeDocumentDTO,
  type SalaryPaymentDTO,
} from "@/lib/services/employees";
import { EMPLOYEE_DOC_MAX_BYTES } from "@/lib/constants";

const INVALID = "Please fix the highlighted fields.";

function revalidateEmployees(id?: string) {
  revalidatePath("/employees");
  if (id) revalidatePath(`/employees/${id}`);
}

export async function createEmployeeAction(input: EmployeeInput): Promise<ActionResult<EmployeeDTO>> {
  try {
    const user = await requirePermission("employee.manage");
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const employee = await createEmployee(parsed.data, user);
    revalidateEmployees(employee.id);
    return { ok: true, data: employee };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateEmployeeAction(id: string, input: EmployeeInput): Promise<ActionResult<EmployeeDTO>> {
  try {
    const user = await requirePermission("employee.manage");
    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const employee = await updateEmployee(id, parsed.data, user);
    revalidateEmployees(employee.id);
    return { ok: true, data: employee };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setEmployeeActiveAction(id: string, active: boolean): Promise<ActionResult<EmployeeDTO>> {
  try {
    const user = await requirePermission("employee.manage");
    const employee = await setEmployeeActive(id, active, user);
    revalidateEmployees(employee.id);
    return { ok: true, data: employee };
  } catch (err) {
    return toActionError(err);
  }
}

/** Multipart upload: fields `employeeId`, `kind`, `file`. */
export async function uploadEmployeeDocumentAction(formData: FormData): Promise<ActionResult<EmployeeDocumentDTO>> {
  try {
    const user = await requirePermission("employee.manage");
    const employeeId = String(formData.get("employeeId") ?? "");
    const kind = employeeDocumentKindSchema.safeParse(formData.get("kind") ?? "OTHER");
    const file = formData.get("file");
    if (!employeeId) return { ok: false, error: "Employee is missing." };
    if (!kind.success) return { ok: false, error: "Choose a document type." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload.", fieldErrors: { file: "Choose a file to upload." } };
    if (file.size > EMPLOYEE_DOC_MAX_BYTES) {
      const msg = `File is too large. Maximum size is ${Math.round(EMPLOYEE_DOC_MAX_BYTES / 1024 / 1024)} MB.`;
      return { ok: false, error: msg, fieldErrors: { file: msg } };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await addEmployeeDocument(employeeId, { kind: kind.data, fileName: file.name, mimeType: file.type, bytes }, user);
    revalidateEmployees(employeeId);
    return { ok: true, data: doc };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteEmployeeDocumentAction(employeeId: string, documentId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("employee.manage");
    await deleteEmployeeDocument(documentId, user);
    revalidateEmployees(employeeId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

export async function addSalaryPaymentAction(input: SalaryPaymentInput): Promise<ActionResult<SalaryPaymentDTO>> {
  try {
    const user = await requirePermission("employee.manage");
    const parsed = salaryPaymentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: INVALID, fieldErrors: fieldErrors(parsed.error) };
    const payment = await addSalaryPayment(parsed.data, user);
    revalidateEmployees(payment.employeeId);
    return { ok: true, data: payment };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteSalaryPaymentAction(employeeId: string, paymentId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("employee.manage");
    await deleteSalaryPayment(paymentId, user);
    revalidateEmployees(employeeId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}
