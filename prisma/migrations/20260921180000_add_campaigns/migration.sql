-- Campaigns is getting a real backend: a durable Campaign draft row instead
-- of the previous fully client-side, non-persisting "generate" flow.
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "method" TEXT NOT NULL DEFAULT 'ai',
    "name" TEXT NOT NULL,
    "prompt" TEXT,
    "feature" TEXT,
    "featuredProductIds" TEXT NOT NULL DEFAULT '[]',
    "featuredCollectionId" TEXT,
    "discountMethod" TEXT NOT NULL DEFAULT 'none',
    "discountCode" TEXT,
    "discountType" TEXT,
    "discountValue" TEXT,
    "discountStartsAt" DATETIME,
    "discountEndsAt" DATETIME,
    "subject" TEXT,
    "previewText" TEXT,
    "html" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Campaign_shop_createdAt_idx" ON "Campaign"("shop", "createdAt");
