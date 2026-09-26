-- Replace the fixed-section email editor shape with a free-form, ordered
-- block list so the editor can add, duplicate, reorder, hide, and delete
-- arbitrary content (matching the approved Figma Make prototype, Version 8).
-- Existing drafts predate the block model and are not migratable 1:1, so
-- the table is recreated empty; merchants re-customize from the catalog
-- defaults, which is a one-time, dev-environment-only reset.
DROP TABLE IF EXISTS "TemplateCustomization";

CREATE TABLE "TemplateCustomization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "lookId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "emailIndex" INTEGER NOT NULL,
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "style" TEXT NOT NULL DEFAULT '{}',
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
