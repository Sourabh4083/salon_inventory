export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export const DEFAULT_LOW_STOCK_THRESHOLD = 4;

/**
 * Shop-wide rule:
 *   quantity = 0                  -> OUT_OF_STOCK
 *   1 <= quantity <= threshold    -> LOW_STOCK
 *   quantity > threshold          -> IN_STOCK
 */
export function getStockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity <= 0) return "OUT_OF_STOCK";
  if (quantity <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

/** Effective threshold for a product: per-product override, else shop-wide setting. */
export function effectiveThreshold(productThreshold: number | null | undefined, globalThreshold: number) {
  return productThreshold ?? globalThreshold;
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "In Stock",
  LOW_STOCK: "Low Stock",
  OUT_OF_STOCK: "Out of Stock",
};
