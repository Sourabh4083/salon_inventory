-- One transaction, so a failure leaves the database unchanged.
BEGIN;

-- CreateEnum
CREATE TYPE "EnquiryKind" AS ENUM ('LEAD', 'SERVICE', 'REPLACE');

-- DropIndex
DROP INDEX "Enquiry_visitedBillId_key";

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "needsService" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "cycleStart" TIMESTAMPTZ(3),
ADD COLUMN     "kind" "EnquiryKind" NOT NULL DEFAULT 'LEAD',
ADD COLUMN     "sourceBillId" TEXT;

-- CreateIndex
CREATE INDEX "Enquiry_visitedBillId_idx" ON "Enquiry"("visitedBillId");

-- CreateIndex
CREATE INDEX "Enquiry_sourceBillId_idx" ON "Enquiry"("sourceBillId");

-- CreateIndex
CREATE INDEX "Enquiry_kind_phoneKey_status_idx" ON "Enquiry"("kind", "phoneKey", "status");

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_sourceBillId_fkey" FOREIGN KEY ("sourceBillId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Products in these categories need servicing to start with; the owner can change this in Settings.
UPDATE "Category" SET "needsService" = true WHERE "name" IN ('Wig', 'Hair System', 'Topper');

-- Reminders for customers who bought such a product (with a phone) in the last 7 months:
-- servicing 25 days after their last visit, replacement 7 months after buying (days in Asia/Kolkata).
WITH sold AS (
  SELECT DISTINCT ON (b."customerPhoneKey")
    b.id, b."customerPhoneKey" AS key, b."customerPhone" AS phone, b."customerName" AS name, b."createdAt" AS bought, b."createdById" AS by,
    (SELECT string_agg(DISTINCT i.name, ', ') FROM "BillItem" i JOIN "Product" p ON p.id = i."productId" JOIN "Category" c ON c.id = p."categoryId"
      WHERE i."billId" = b.id AND c."needsService") AS products
  FROM "Bill" b
  WHERE b.status = 'COMPLETED' AND b."customerPhoneKey" IS NOT NULL AND b."customerPhone" IS NOT NULL
    AND (b."createdAt" AT TIME ZONE 'Asia/Kolkata') + interval '7 months' > (now() AT TIME ZONE 'Asia/Kolkata')
    AND EXISTS (SELECT 1 FROM "BillItem" i JOIN "Product" p ON p.id = i."productId" JOIN "Category" c ON c.id = p."categoryId" WHERE i."billId" = b.id AND c."needsService")
  ORDER BY b."customerPhoneKey", b."createdAt" DESC
),
plan AS (
  SELECT s.*,
    -- A later bill (15+ days after buying) counts as the last servicing visit.
    COALESCE((SELECT max(v."createdAt") FROM "Bill" v WHERE v.status = 'COMPLETED' AND v."customerPhoneKey" = s.key AND v."createdAt" >= s.bought + interval '15 days'), s.bought) AS cycle,
    (date_trunc('day', s.bought AT TIME ZONE 'Asia/Kolkata') + interval '7 months') AT TIME ZONE 'Asia/Kolkata' AS replace_on
  FROM sold s
)
INSERT INTO "Enquiry" (id, kind, name, phone, "phoneKey", interest, status, "nextCallOn", "sourceBillId", "cycleStart", "createdById", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'SERVICE'::"EnquiryKind", p.name, p.phone, p.key, p.products, 'CALL_BACK'::"EnquiryStatus",
  (date_trunc('day', p.cycle AT TIME ZONE 'Asia/Kolkata') + interval '25 days') AT TIME ZONE 'Asia/Kolkata', p.id, p.cycle, p.by, now(), now()
FROM plan p
WHERE (date_trunc('day', p.cycle AT TIME ZONE 'Asia/Kolkata') + interval '25 days') AT TIME ZONE 'Asia/Kolkata' <= p.replace_on
UNION ALL
SELECT gen_random_uuid()::text, 'REPLACE'::"EnquiryKind", p.name, p.phone, p.key, p.products, 'CALL_BACK'::"EnquiryStatus", p.replace_on, p.id, NULL, p.by, now(), now()
FROM plan p;

COMMIT;
