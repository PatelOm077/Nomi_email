-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN "emailId" TEXT;
ALTER TABLE "EmailJob" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "flowSettings" TEXT NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "EmailJob_shop_customerId_status_idx" ON "EmailJob"("shop", "customerId", "status");
