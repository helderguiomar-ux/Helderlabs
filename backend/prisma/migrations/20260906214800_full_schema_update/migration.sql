-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PLANNED', 'PAID');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "LoanDirection" AS ENUM ('LENT', 'BORROWED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('OPEN', 'PARTIAL', 'SETTLED', 'WRITTEN_OFF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ApplicationStatus" ADD VALUE 'GRACE';
ALTER TYPE "ApplicationStatus" ADD VALUE 'SUSPENDED';

-- DropForeignKey
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_moduleId_fkey";

-- DropForeignKey
ALTER TABLE "tenant_modules" DROP CONSTRAINT "tenant_modules_tenantId_fkey";

-- DropIndex
DROP INDEX "audit_logs_tenantId_idx";

-- DropIndex
DROP INDEX "modules_name_key";

-- AlterTable
ALTER TABLE "account_requests" ADD COLUMN     "acceptedPrivacyAt" TIMESTAMP(3),
ADD COLUMN     "acceptedTermsAt" TIMESTAMP(3),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "intendedModule" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "privacyVersion" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "application_instances" ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "graceDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "limits" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "plan" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "impersonationId" TEXT,
ADD COLUMN     "onBehalfOfId" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "seq" BIGSERIAL NOT NULL,
DROP COLUMN "oldValue",
ADD COLUMN     "oldValue" JSONB,
DROP COLUMN "newValue",
ADD COLUMN     "newValue" JSONB;

-- AlterTable
ALTER TABLE "modules" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Geral',
ADD COLUMN     "color" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "key" TEXT NOT NULL,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "entitlementsVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "tenant_modules";

-- CreateTable
CREATE TABLE "tenant_branding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "logoDarkUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#0d419f',
    "accentColor" TEXT NOT NULL DEFAULT '#0d419f',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "displayName" TEXT,
    "legalName" TEXT,
    "taxNumber" TEXT,
    "addressLine" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'PT',
    "locale" TEXT NOT NULL DEFAULT 'pt-PT',
    "timezone" TEXT NOT NULL DEFAULT 'Atlantic/Madeira',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "dateFormat" TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 23,
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 1,
    "emailFromName" TEXT,
    "emailFromAddress" TEXT,
    "emailFooter" TEXT,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "showUpsell" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "targetTenantId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "reason" TEXT NOT NULL,
    "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "ipAddress" TEXT,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "dueDate" DATE NOT NULL,
    "paidDate" DATE,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PLANNED',
    "categoryId" TEXT,
    "notes" TEXT,
    "method" TEXT,
    "recurringRuleId" TEXT,
    "loanId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_recurring_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "categoryId" TEXT,
    "freq" "RecurrenceFreq" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_recurring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_loans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "direction" "LoanDirection" NOT NULL,
    "principalCents" INTEGER NOT NULL,
    "loanDate" DATE NOT NULL,
    "dueDate" DATE,
    "status" "LoanStatus" NOT NULL DEFAULT 'OPEN',
    "settledDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_loan_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_loan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "limitCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_branding_tenantId_key" ON "tenant_branding"("tenantId");

-- CreateIndex
CREATE INDEX "impersonation_sessions_actorUserId_idx" ON "impersonation_sessions"("actorUserId");

-- CreateIndex
CREATE INDEX "impersonation_sessions_targetTenantId_idx" ON "impersonation_sessions"("targetTenantId");

-- CreateIndex
CREATE INDEX "finance_categories_tenantId_idx" ON "finance_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_tenantId_name_kind_key" ON "finance_categories"("tenantId", "name", "kind");

-- CreateIndex
CREATE INDEX "finance_transactions_tenantId_dueDate_idx" ON "finance_transactions"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "finance_transactions_tenantId_status_idx" ON "finance_transactions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "finance_recurring_rules_tenantId_active_idx" ON "finance_recurring_rules"("tenantId", "active");

-- CreateIndex
CREATE INDEX "finance_loans_tenantId_status_idx" ON "finance_loans"("tenantId", "status");

-- CreateIndex
CREATE INDEX "finance_loan_payments_tenantId_idx" ON "finance_loan_payments"("tenantId");

-- CreateIndex
CREATE INDEX "finance_loan_payments_loanId_idx" ON "finance_loan_payments"("loanId");

-- CreateIndex
CREATE INDEX "finance_budgets_tenantId_period_idx" ON "finance_budgets"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "finance_budgets_tenantId_categoryId_period_key" ON "finance_budgets"("tenantId", "categoryId", "period");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_timestamp_idx" ON "audit_logs"("tenantId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "modules_key_key" ON "modules"("key");

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "finance_recurring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "finance_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_recurring_rules" ADD CONSTRAINT "finance_recurring_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_recurring_rules" ADD CONSTRAINT "finance_recurring_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_loans" ADD CONSTRAINT "finance_loans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_loan_payments" ADD CONSTRAINT "finance_loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "finance_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_budgets" ADD CONSTRAINT "finance_budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

