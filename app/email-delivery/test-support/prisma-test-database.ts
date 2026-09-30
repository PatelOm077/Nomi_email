import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export type PrismaTestDatabase = {
  client: PrismaClient;
  directory: string;
  dispose: () => Promise<void>;
};

export async function createPrismaTestDatabase(
  prefix: string,
): Promise<PrismaTestDatabase> {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const databasePath = join(directory, "test.sqlite").replace(/\\/g, "/");
  const client = new PrismaClient({
    datasourceUrl: `file:${databasePath}`,
  });

  await client.$executeRawUnsafe(`
    CREATE TABLE "ShopSettings" (
      "shop" TEXT NOT NULL PRIMARY KEY,
      "sendingEnabled" BOOLEAN NOT NULL DEFAULT false,
      "onboardingCompletedAt" DATETIME,
      "appEmbedVerifiedAt" DATETIME,
      "language" TEXT NOT NULL DEFAULT 'en',
      "tone" TEXT NOT NULL DEFAULT 'warm-plain',
      "brandLogoUrl" TEXT,
      "brandPrimaryColor" TEXT,
      "senderName" TEXT,
      "senderWebsite" TEXT,
      "senderCountry" TEXT,
      "senderProvince" TEXT,
      "senderCity" TEXT,
      "senderPostalCode" TEXT,
      "senderAddress" TEXT,
      "excludedProductIds" TEXT NOT NULL DEFAULT '[]',
      "plan" TEXT NOT NULL DEFAULT 'free',
      "subscribedContacts" INTEGER,
      "contactsCountedAt" DATETIME,
      "flowSettings" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "AccessLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actor" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "target" TEXT
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "SendingDomain" (
      "shop" TEXT NOT NULL PRIMARY KEY,
      "domain" TEXT NOT NULL UNIQUE,
      "provider" TEXT NOT NULL DEFAULT 'resend',
      "providerDomainId" TEXT NOT NULL UNIQUE,
      "region" TEXT NOT NULL DEFAULT 'us-east-1',
      "returnPath" TEXT NOT NULL DEFAULT 'send',
      "status" TEXT NOT NULL,
      "records" TEXT NOT NULL DEFAULT '[]',
      "recordNotes" TEXT NOT NULL DEFAULT '{}',
      "dmarcState" TEXT NOT NULL DEFAULT 'unknown',
      "dmarcValue" TEXT,
      "lastCheckedAt" DATETIME,
      "verifiedAt" DATETIME,
      "lastError" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "UsageCounter" (
      "shop" TEXT NOT NULL,
      "period" TEXT NOT NULL,
      "metric" TEXT NOT NULL,
      "count" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" DATETIME NOT NULL,
      PRIMARY KEY ("shop", "period", "metric")
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE "EmailJob" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "webhookId" TEXT NOT NULL,
      "shop" TEXT NOT NULL,
      "topic" TEXT NOT NULL,
      "payload" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastError" TEXT,
      "providerMessageId" TEXT,
      "preparedEmail" TEXT,
      "deliveryStartedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "sentAt" DATETIME,
      "recipient" TEXT,
      "emailId" TEXT,
      "customerId" TEXT,
      "openedAt" DATETIME,
      "clickedAt" DATETIME,
      "convertedAt" DATETIME,
      "conversionOrderId" TEXT,
      "conversionValue" REAL,
      "conversionCurrency" TEXT
    )
  `);
  await client.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "EmailJob_webhookId_key" ON "EmailJob"("webhookId")',
  );
  await client.$executeRawUnsafe(
    'CREATE INDEX "EmailJob_status_availableAt_idx" ON "EmailJob"("status", "availableAt")',
  );
  await client.$executeRawUnsafe(`
    CREATE TABLE "BrandStudioProfile" (
      "shop" TEXT NOT NULL PRIMARY KEY,
      "status" TEXT NOT NULL DEFAULT 'new',
      "evidence" TEXT NOT NULL DEFAULT '{}',
      "snapshot" TEXT NOT NULL DEFAULT '{}',
      "audience" TEXT,
      "feeling" TEXT,
      "directions" TEXT NOT NULL DEFAULT '[]',
      "selectedDirectionId" TEXT,
      "refinement" TEXT,
      "brandSystem" TEXT NOT NULL DEFAULT '{}',
      "lifecycleRecipes" TEXT NOT NULL DEFAULT '[]',
      "renderedEmails" TEXT NOT NULL DEFAULT '{}',
      "evidenceFingerprint" TEXT NOT NULL DEFAULT '',
      "snapshotEvidenceFingerprint" TEXT NOT NULL DEFAULT '',
      "generatedEvidenceFingerprint" TEXT NOT NULL DEFAULT '',
      "evidenceRefreshedAt" DATETIME,
      "currentBuildCostMicros" INTEGER NOT NULL DEFAULT 0,
      "photoKit" TEXT NOT NULL DEFAULT '[]',
      "emailPlans" TEXT NOT NULL DEFAULT '{}',
      "openAiInputTokens" INTEGER NOT NULL DEFAULT 0,
      "openAiOutputTokens" INTEGER NOT NULL DEFAULT 0,
      "anthropicInputTokens" INTEGER NOT NULL DEFAULT 0,
      "anthropicOutputTokens" INTEGER NOT NULL DEFAULT 0,
      "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
      "completedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);

  return {
    client,
    directory,
    dispose: async () => {
      await client.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
