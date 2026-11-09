-- A bill (open or finished) can be handled by several employees.

-- CreateTable
CREATE TABLE "_BillEmployees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_BillEmployees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OpenBillEmployees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OpenBillEmployees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BillEmployees_B_index" ON "_BillEmployees"("B");

-- CreateIndex
CREATE INDEX "_OpenBillEmployees_B_index" ON "_OpenBillEmployees"("B");

-- AddForeignKey
ALTER TABLE "_BillEmployees" ADD CONSTRAINT "_BillEmployees_A_fkey" FOREIGN KEY ("A") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BillEmployees" ADD CONSTRAINT "_BillEmployees_B_fkey" FOREIGN KEY ("B") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OpenBillEmployees" ADD CONSTRAINT "_OpenBillEmployees_A_fkey" FOREIGN KEY ("A") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OpenBillEmployees" ADD CONSTRAINT "_OpenBillEmployees_B_fkey" FOREIGN KEY ("B") REFERENCES "OpenBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the employee already on each open bill (A = Employee, B = OpenBill).
INSERT INTO "_OpenBillEmployees" ("A", "B") SELECT "employeeId", "id" FROM "OpenBill";

-- DropForeignKey
ALTER TABLE "OpenBill" DROP CONSTRAINT "OpenBill_employeeId_fkey";

-- AlterTable
ALTER TABLE "OpenBill" DROP COLUMN "employeeId";
