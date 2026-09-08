/**
 * Edge-safe session token helpers (no database, no Node-only APIs) so the proxy can
 * verify cookies. Role in the token is a fast hint only; pages and actions always
 * re-check the user in the database.
 */
import { SignJWT, jwtVerify } from "jose";
import { SESSION_DURATION_SECONDS } from "@/lib/constants";
import type { Role } from "@/generated/prisma/enums";

export type SessionClaims = { userId: string; role: Role };

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set to a value of at least 16 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(claims: SessionClaims) {
  return new SignJWT({ sub: claims.userId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    const role = payload.role === "OWNER" || payload.role === "MANAGER" ? payload.role : "MANAGER";
    return { userId: payload.sub, role };
  } catch {
    return null;
  }
}
