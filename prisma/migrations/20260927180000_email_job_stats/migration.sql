ALTER TABLE "EmailJob" ADD COLUMN "recipient" TEXT;
ALTER TABLE "EmailJob" ADD COLUMN "openedAt" DATETIME;
ALTER TABLE "EmailJob" ADD COLUMN "clickedAt" DATETIME;
ALTER TABLE "EmailJob" ADD COLUMN "convertedAt" DATETIME;
ALTER TABLE "EmailJob" ADD COLUMN "conversionOrderId" TEXT;
ALTER TABLE "EmailJob" ADD COLUMN "conversionValue" REAL;
ALTER TABLE "EmailJob" ADD COLUMN "conversionCurrency" TEXT;

-- Emails sent before this migration: recover the recipient from the frozen
-- provider request so their later orders can still be attributed.
UPDATE "EmailJob"
SET "recipient" = lower(json_extract("preparedEmail", '$.to'))
WHERE "status" = 'sent' AND "preparedEmail" IS NOT NULL AND json_valid("preparedEmail");

CREATE INDEX "EmailJob_shop_sentAt_idx" ON "EmailJob"("shop", "sentAt");
CREATE INDEX "EmailJob_shop_recipient_sentAt_idx" ON "EmailJob"("shop", "recipient", "sentAt");
