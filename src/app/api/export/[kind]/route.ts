import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/lib/services/export";

/**
 * Owner-only Excel download of a list (products, bills, reports, ...). The role is
 * re-checked against the database here; the proxy only ensures a login.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "data.export")) return NextResponse.json({ error: "Owner only." }, { status: 403 });

  const { kind } = await context.params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const file = await buildExport(kind as ExportKind, params, user);
  return new NextResponse(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(file.body.byteLength),
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
