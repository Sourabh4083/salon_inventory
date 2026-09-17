import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { getEmployeeDocumentFile } from "@/lib/services/employees";

export const dynamic = "force-dynamic";

/**
 * Serves an uploaded employee document (Aadhaar image / PDF) from the database.
 * Owner-only: the proxy already requires a login for /api, and this re-checks the
 * role against the database so a tampered token cannot read personal documents.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; docId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "employee.manage")) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const { id, docId } = await context.params;
  const file = await getEmployeeDocumentFile(id, docId);
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const safeName = file.fileName.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
