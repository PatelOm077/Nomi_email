ALTER TABLE "BrandStudioProfile" ADD COLUMN "evidenceFingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BrandStudioProfile" ADD COLUMN "generatedEvidenceFingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BrandStudioProfile" ADD COLUMN "evidenceRefreshedAt" DATETIME;
ALTER TABLE "BrandStudioProfile" ADD COLUMN "currentBuildCostMicros" INTEGER NOT NULL DEFAULT 0;

-- Existing completed profiles predate evidence provenance. Mark them
-- explicitly unverified so delivery cannot silently trust stale output.
UPDATE "BrandStudioProfile"
SET "evidenceFingerprint" = 'legacy-unverified',
    "generatedEvidenceFingerprint" = ''
WHERE "status" = 'complete';

UPDATE "BrandStudioProfile"
SET "currentBuildCostMicros" = "estimatedCostMicros"
WHERE "status" <> 'complete';
