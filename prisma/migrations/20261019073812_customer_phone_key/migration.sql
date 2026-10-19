-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "customerPhoneKey" TEXT;

-- CreateIndex
CREATE INDEX "Bill_customerPhoneKey_idx" ON "Bill"("customerPhoneKey");

-- Fill in the key for existing bills: the last 10 digits of the phone, when it has at least 10.
UPDATE "Bill"
SET "customerPhoneKey" = right(regexp_replace("customerPhone", '\D', '', 'g'), 10)
WHERE length(regexp_replace("customerPhone", '\D', '', 'g')) >= 10;
