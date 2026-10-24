-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "shareExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Bill_shareToken_key" ON "Bill"("shareToken");

