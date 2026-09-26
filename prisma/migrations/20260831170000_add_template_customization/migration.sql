-- CreateTable
CREATE TABLE "TemplateCustomization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "lookId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "emailIndex" INTEGER NOT NULL,
    "eyebrow" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bodyCopy" TEXT NOT NULL,
    "buttonLabel" TEXT NOT NULL,
    "sectionOrder" TEXT NOT NULL,
    "hiddenSections" TEXT NOT NULL,
    "palette" TEXT NOT NULL,
    "typography" TEXT NOT NULL,
    "spacing" INTEGER NOT NULL,
    "buttonStyle" TEXT NOT NULL,
    "applySeries" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCustomization_shop_lookId_flowId_emailIndex_key"
ON "TemplateCustomization"("shop", "lookId", "flowId", "emailIndex");

-- CreateIndex
CREATE INDEX "TemplateCustomization_shop_lookId_flowId_idx"
ON "TemplateCustomization"("shop", "lookId", "flowId");
