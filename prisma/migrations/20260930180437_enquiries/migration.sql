-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'NO_ANSWER', 'CALL_BACK', 'COMING', 'NOT_INTERESTED', 'VISITED');

-- CreateEnum
CREATE TYPE "CallResult" AS ENUM ('COMING', 'CALL_BACK', 'NO_ANSWER', 'NOT_INTERESTED');

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "interest" TEXT,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "nextCallOn" TIMESTAMP(3),
    "comingOn" TIMESTAMP(3),
    "visitedBillId" TEXT,
    "visitedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryCall" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "result" "CallResult" NOT NULL,
    "note" TEXT,
    "followUpOn" TIMESTAMP(3),
    "calledById" TEXT NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_visitedBillId_key" ON "Enquiry"("visitedBillId");

-- CreateIndex
CREATE INDEX "Enquiry_status_nextCallOn_idx" ON "Enquiry"("status", "nextCallOn");

-- CreateIndex
CREATE INDEX "Enquiry_status_comingOn_idx" ON "Enquiry"("status", "comingOn");

-- CreateIndex
CREATE INDEX "Enquiry_phoneKey_idx" ON "Enquiry"("phoneKey");

-- CreateIndex
CREATE INDEX "EnquiryCall_enquiryId_calledAt_idx" ON "EnquiryCall"("enquiryId", "calledAt");

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_visitedBillId_fkey" FOREIGN KEY ("visitedBillId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryCall" ADD CONSTRAINT "EnquiryCall_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryCall" ADD CONSTRAINT "EnquiryCall_calledById_fkey" FOREIGN KEY ("calledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
