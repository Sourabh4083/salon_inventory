"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/permissions";

const RoleContext = createContext<Role>("MANAGER");

/** Provides the signed-in user's role to client components (set once in AppShell). */
export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

/** UI-only convenience; the server re-checks every permission. */
export function useCan(permission: Permission): boolean {
  return can(useContext(RoleContext), permission);
}
