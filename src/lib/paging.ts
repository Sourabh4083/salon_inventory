import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/constants";

/**
 * Reads `?page=` and `?size=` from a list page's search params. The size must be
 * one of the "Rows per page" choices; anything else falls back to the page's default.
 */
export function parsePaging(params: { page?: string; size?: string }, defaultSize: number = PAGE_SIZE): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const size = Number(params.size);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : defaultSize;
  return { page, pageSize };
}
