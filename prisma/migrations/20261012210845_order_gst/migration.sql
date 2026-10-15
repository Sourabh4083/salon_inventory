-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "cgst" DECIMAL(12,2),
ADD COLUMN     "gstPaidAt" TIMESTAMP(3),
ADD COLUMN     "gstPaymentMethod" "PaymentMethod",
ADD COLUMN     "sgst" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "PurchaseOrder_gstPaidAt_idx" ON "PurchaseOrder"("gstPaidAt");
