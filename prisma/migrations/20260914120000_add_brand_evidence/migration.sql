-- Persist the exact, merchant-confirmed evidence used to generate a Brand System.
ALTER TABLE "BrandStudioProfile" ADD COLUMN "evidence" TEXT NOT NULL DEFAULT '{}';
