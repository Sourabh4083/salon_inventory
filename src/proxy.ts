import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { verifySessionToken } from "@/lib/auth/token";

/**
 * First line of defence, runs before any page renders:
 *  - anonymous or invalid-token visitors are sent to /login
 *  - owner-only areas reject non-owner tokens
 * The real authorisation (fresh database lookup, disabled accounts) happens in
 * layouts, pages and every server action.
 */
const OWNER_ONLY_PREFIXES = ["/users", "/settings", "/reports", "/activity", "/pricing", "/employees"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    // A page found the cookie's user missing/disabled: drop the cookie and show the login form.
    if (request.nextUrl.searchParams.get("stale") === "1") {
      const url = new URL("/login", request.url);
      const res = NextResponse.redirect(url);
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    if (claims) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  if (!claims) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE); // drop invalid/expired cookies
    return res;
  }

  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));

  if (claims.role !== "OWNER" && OWNER_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.redirect(new URL("/dashboard?denied=1", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/inventory/:path*",
    "/activity/:path*",
    "/users/:path*",
    "/settings/:path*",
    "/scan/:path*",
    "/billing/:path*",
    "/reports/:path*",
    "/pricing/:path*",
    "/employees/:path*",
    "/api/:path*",
  ],
};
