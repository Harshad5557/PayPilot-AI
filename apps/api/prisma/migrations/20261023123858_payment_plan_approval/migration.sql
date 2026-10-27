/*
  Warnings:

  - Added the required column `proposalVersion` to the `PaymentPlan` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaymentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposalJson" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "proposalVersion" TEXT NOT NULL,
    "approvedProposalVersion" TEXT,
    "approvedAmount" INTEGER,
    "approvedCurrency" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PaymentPlan" ("approvedAt", "createdAt", "currency", "expiresAt", "id", "ownerId", "proposalJson", "status", "totalAmount") SELECT "approvedAt", "createdAt", "currency", "expiresAt", "id", "ownerId", "proposalJson", "status", "totalAmount" FROM "PaymentPlan";
DROP TABLE "PaymentPlan";
ALTER TABLE "new_PaymentPlan" RENAME TO "PaymentPlan";
CREATE UNIQUE INDEX "PaymentPlan_proposalVersion_key" ON "PaymentPlan"("proposalVersion");
CREATE INDEX "PaymentPlan_ownerId_idx" ON "PaymentPlan"("ownerId");
CREATE INDEX "PaymentPlan_status_idx" ON "PaymentPlan"("status");
CREATE INDEX "PaymentPlan_expiresAt_idx" ON "PaymentPlan"("expiresAt");
CREATE INDEX "PaymentPlan_ownerId_status_idx" ON "PaymentPlan"("ownerId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
