-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "openingAt" TIMESTAMP(3),
ADD COLUMN     "openingBank" DECIMAL(12,2),
ADD COLUMN     "openingCash" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "EmployeeAdvance" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "paymentMethod" "PaymentMethod";
