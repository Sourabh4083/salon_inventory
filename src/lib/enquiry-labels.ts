import type { CallResult } from "@/generated/prisma/enums";

/** What the customer said on a call, as shown on the Calls page and the bill screen. */
export const RESULT_TEXT: Record<CallResult, string> = {
  COMING: "Coming",
  CALL_BACK: "Call back later",
  NO_ANSWER: "No answer",
  NOT_INTERESTED: "Not interested",
};
