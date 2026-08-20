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
      "sendReceiptEmails" BOOLEAN NOT NULL DEFAULT false,
      "language" TEXT NOT NULL DEFAULT 'en',
      "tone" TEXT NOT NULL DEFAULT 'warm-plain',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "sentAt" DATETIME
    )
  `);
  await client.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "EmailJob_webhookId_key" ON "EmailJob"("webhookId")',
  );
  await client.$executeRawUnsafe(
    'CREATE INDEX "EmailJob_status_availableAt_idx" ON "EmailJob"("status", "availableAt")',
  );

  return {
    client,
    directory,
    dispose: async () => {
      await client.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
