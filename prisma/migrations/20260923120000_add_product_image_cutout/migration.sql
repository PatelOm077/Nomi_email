-- Caches a product's background-removed cutout photo (optional,
-- REMOVE_BG_API_KEY-gated feature — see app/email-engine/background-removal.ts)
-- so the same product is never billed to the paid removal API twice across
-- campaigns.
CREATE TABLE "ProductImageCutout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceImageUrl" TEXT NOT NULL,
    "cutoutImageUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductImageCutout_shop_productId_sourceImageUrl_key" ON "ProductImageCutout"("shop", "productId", "sourceImageUrl");
