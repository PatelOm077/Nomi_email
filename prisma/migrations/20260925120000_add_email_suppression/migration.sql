-- Addresses a shop must never email again (unsubscribes, bounces, complaints).
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "EmailSuppression_shop_email_key" ON "EmailSuppression"("shop", "email");
