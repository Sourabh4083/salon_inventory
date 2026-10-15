-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "ownerNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "OwnerWithdrawal" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "takenOn" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerWithdrawal_takenOn_idx" ON "OwnerWithdrawal"("takenOn");

-- CreateIndex
CREATE INDEX "OwnerWithdrawal_ownerName_takenOn_idx" ON "OwnerWithdrawal"("ownerName", "takenOn");

-- AddForeignKey
ALTER TABLE "OwnerWithdrawal" ADD CONSTRAINT "OwnerWithdrawal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
