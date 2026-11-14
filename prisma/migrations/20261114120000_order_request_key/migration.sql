-- A key the order screen sends once per new order, so a retry after a lost connection
-- returns the order already placed instead of placing (and paying for) it twice.
ALTER TABLE "PurchaseOrder" ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "PurchaseOrder_requestKey_key" ON "PurchaseOrder"("requestKey");
