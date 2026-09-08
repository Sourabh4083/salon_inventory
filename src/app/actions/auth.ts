"use server";

import { redirect } from "next/navigation";
import { loginSchema, fieldErrors } from "@/lib/validation/schemas";
import { authenticate } from "@/lib/services/users";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export type LoginState = { error?: string; fieldErrors?: Record<string, string> } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  let user;
  try {
    user = await authenticate(parsed.data.email, parsed.data.password);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: "Unable to sign in right now. Please try again." };
  }
  if (!user) return { error: "Incorrect email or password." };

  await setSessionCookie(user);
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
