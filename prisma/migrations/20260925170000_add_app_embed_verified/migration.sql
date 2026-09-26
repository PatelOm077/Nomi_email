-- Durable per-shop flag for the theme app embed setup gate.
ALTER TABLE "ShopSettings" ADD COLUMN "appEmbedVerifiedAt" DATETIME;
