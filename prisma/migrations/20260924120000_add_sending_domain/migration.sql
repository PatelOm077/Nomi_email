-- Per-shop sending domain registered with Resend (see SENDING_DOMAIN.md).
CREATE TABLE "SendingDomain" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "providerDomainId" TEXT NOT NULL,
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
);

-- CreateIndex
CREATE UNIQUE INDEX "SendingDomain_domain_key" ON "SendingDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "SendingDomain_providerDomainId_key" ON "SendingDomain"("providerDomainId");
