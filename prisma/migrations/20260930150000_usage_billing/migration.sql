-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "shopGid" TEXT;

-- CreateTable
CREATE TABLE "UsageReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "block" INTEGER NOT NULL,
    "reportedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UsageReport_reportedAt_attempts_idx" ON "UsageReport"("reportedAt", "attempts");
