-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN "providerErrorCode" TEXT;
ALTER TABLE "PaymentAttempt" ADD COLUMN "providerStatus" TEXT;

-- CreateTable
CREATE TABLE "PaymentAttemptInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentAttemptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    CONSTRAINT "PaymentAttemptInvoice_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentAttemptInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PaymentAttemptInvoice_invoiceId_idx" ON "PaymentAttemptInvoice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttemptInvoice_paymentAttemptId_invoiceId_key" ON "PaymentAttemptInvoice"("paymentAttemptId", "invoiceId");
