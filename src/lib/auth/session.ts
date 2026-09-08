import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_DURATION_SECONDS } from "@/lib/constants";
import { createSessionToken, verifySessionToken } from "@/lib/auth/token";
import type { Role } from "@/generated/prisma/enums";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export async function setSessionCookie(user: { id: string; role: Role }) {
  const token = await createSessionToken({ userId: user.id, role: user.role });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https"),
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Resolves the logged-in user from the session cookie, re-checking the database
 * so disabled accounts (or changed roles) take effect immediately. Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});
