-- A key the new-bill screen sends once per bill, so pressing Save again after a lost
-- connection returns the bill already made instead of making it (and taking stock) twice.
ALTER TABLE "Bill" ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "Bill_requestKey_key" ON "Bill"("requestKey");
