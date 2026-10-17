-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" "PaymentMethod";

-- CreateIndex
CREATE INDEX "PurchaseOrder_paidAt_idx" ON "PurchaseOrder"("paidAt");
