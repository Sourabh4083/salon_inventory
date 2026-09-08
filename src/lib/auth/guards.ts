import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/constants";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";

/** For pages: redirect to login when not signed in. */
export async function requireUserPage(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    // A validly signed cookie whose user no longer exists (e.g. the database was
    // replaced) would otherwise bounce between the proxy and this page forever.
    // The proxy clears the cookie when it sees ?stale=1.
    const store = await cookies();
    redirect(store.get(SESSION_COOKIE) ? "/login?stale=1" : "/login");
  }
  return user;
}

/** For pages: redirect to dashboard when the user lacks a permission. */
export async function requirePermissionPage(permission: Permission): Promise<SessionUser> {
  const user = await requireUserPage();
  if (!can(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}

/** For server actions / route handlers: throw instead of redirecting. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("You must be signed in.", "UNAUTHENTICATED");
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) {
    throw new AppError("You do not have permission to perform this action.", "FORBIDDEN");
  }
  return user;
}
