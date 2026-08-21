-- CreateTable
CREATE TABLE "LifecycleTemplateChoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ai',
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "buttonText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleTemplateChoice_shop_slotId_key" ON "LifecycleTemplateChoice"("shop", "slotId");
