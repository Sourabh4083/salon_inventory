/** Error thrown by services for expected business-rule failures. Safe to show to users. */
export type AppErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_STOCK"
  | "CONFLICT";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode = "VALIDATION",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class InsufficientStockError extends AppError {
  constructor(public readonly available: number) {
    super(
      available === 0
        ? "This product is out of stock."
        : `Only ${available} ${available === 1 ? "unit is" : "units are"} currently available.`,
      "INSUFFICIENT_STOCK",
    );
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: AppErrorCode; fieldErrors?: Record<string, string> };

export function toActionError(err: unknown): { ok: false; error: string; code?: AppErrorCode } {
  if (err instanceof AppError) return { ok: false, error: err.message, code: err.code };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}
