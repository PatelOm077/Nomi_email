ALTER TABLE "ShopSettings" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';

CREATE TABLE "UsageCounter" (
    "shop" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("shop", "period", "metric")
);
