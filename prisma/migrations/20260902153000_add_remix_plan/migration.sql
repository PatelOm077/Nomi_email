-- CreateTable
CREATE TABLE "RemixPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "goalLabel" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "maxDiscount" INTEGER,
    "productScope" TEXT,
    "directions" TEXT NOT NULL DEFAULT '[]',
    "compiledEmails" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedBy" TEXT NOT NULL DEFAULT 'gpt',
    "reviewedBy" TEXT NOT NULL DEFAULT 'claude',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "approvedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "RemixPlan_shop_updatedAt_idx" ON "RemixPlan"("shop", "updatedAt");
