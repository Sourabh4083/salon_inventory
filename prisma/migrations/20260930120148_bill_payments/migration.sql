-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "balanceDue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ALTER COLUMN "paymentMethod" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atBilling" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillPayment_billId_idx" ON "BillPayment"("billId");

-- CreateIndex
CREATE INDEX "BillPayment_paidAt_idx" ON "BillPayment"("paidAt");

-- CreateIndex
CREATE INDEX "Bill_status_balanceDue_idx" ON "Bill"("status", "balanceDue");

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing bill was paid in full at the counter, so record that as one
-- payment on the bill's own date and method. Reports stay exactly as they were.
INSERT INTO "BillPayment" ("id", "billId", "amount", "method", "paidAt", "atBilling", "createdById", "createdAt")
SELECT gen_random_uuid()::text, b."id", b."total", COALESCE(b."paymentMethod", 'CASH'), b."createdAt", true, b."createdById", b."createdAt"
FROM "Bill" b
WHERE b."total" > 0;
