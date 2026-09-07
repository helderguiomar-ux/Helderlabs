-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TransactionType" AS ENUM ('REVENUE', 'EXPENSE', 'TRANSFER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
DO $$ BEGIN
    ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'PENDING';
    ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
    ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
    ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'RECONCILED';
EXCEPTION
    WHEN others THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ExpenseCategory" AS ENUM ('SALARY', 'RENT', 'UTILITIES', 'OFFICE_SUPPLIES', 'TRAVEL', 'PROFESSIONAL_SERVICES', 'MAINTENANCE', 'MARKETING', 'INSURANCE', 'TAXES', 'DEPRECIATION', 'INTEREST', 'MISCELLANEOUS');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- DropForeignKey (if existing finance_budgets)
ALTER TABLE IF EXISTS "finance_budgets" DROP CONSTRAINT IF EXISTS "finance_budgets_categoryId_fkey";
ALTER TABLE IF EXISTS "finance_budgets" DROP CONSTRAINT IF EXISTS "finance_budgets_tenantId_fkey";
DROP TABLE IF EXISTS "finance_budgets" CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "financial_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "category" "ExpenseCategory",
    "accountId" TEXT,
    "costCenter" TEXT,
    "projectId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceUrl" TEXT,
    "supplier" TEXT,
    "customer" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNRECONCILED',
    "reconciliationDate" TIMESTAMP(3),
    "bankStatementRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "financial_attachments" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "alertThreshold" INTEGER NOT NULL DEFAULT 90,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "budget_items" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "budgetAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_flow_projections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "inflows" DOUBLE PRECISION NOT NULL,
    "outflows" DOUBLE PRECISION NOT NULL,
    "closingBalance" DOUBLE PRECISION NOT NULL,
    "scenario" TEXT NOT NULL DEFAULT 'BASE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_flow_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementAmount" DOUBLE PRECISION NOT NULL,
    "reconciledTransactionCount" INTEGER NOT NULL DEFAULT 0,
    "reconciledAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "reconciliationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "financial_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_invoiceNumber_key" ON "financial_transactions"("invoiceNumber");
CREATE INDEX IF NOT EXISTS "financial_transactions_tenantId_idx" ON "financial_transactions"("tenantId");
CREATE INDEX IF NOT EXISTS "financial_transactions_type_idx" ON "financial_transactions"("type");
CREATE INDEX IF NOT EXISTS "financial_transactions_status_idx" ON "financial_transactions"("status");
CREATE INDEX IF NOT EXISTS "financial_transactions_date_idx" ON "financial_transactions"("date");
CREATE INDEX IF NOT EXISTS "financial_transactions_category_idx" ON "financial_transactions"("category");
CREATE INDEX IF NOT EXISTS "financial_transactions_reconciliationStatus_idx" ON "financial_transactions"("reconciliationStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "financial_attachments_transactionId_idx" ON "financial_attachments"("transactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "budgets_tenantId_idx" ON "budgets"("tenantId");
CREATE INDEX IF NOT EXISTS "budgets_status_idx" ON "budgets"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_tenantId_year_month_key" ON "budgets"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "budget_items_budgetId_idx" ON "budget_items"("budgetId");
CREATE UNIQUE INDEX IF NOT EXISTS "budget_items_budgetId_category_key" ON "budget_items"("budgetId", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_flow_projections_tenantId_idx" ON "cash_flow_projections"("tenantId");
CREATE INDEX IF NOT EXISTS "cash_flow_projections_year_month_idx" ON "cash_flow_projections"("year", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_flow_projections_tenantId_date_scenario_key" ON "cash_flow_projections"("tenantId", "date", "scenario");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_reconciliations_tenantId_idx" ON "bank_reconciliations"("tenantId");
CREATE INDEX IF NOT EXISTS "bank_reconciliations_statementDate_idx" ON "bank_reconciliations"("statementDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "financial_reports_tenantId_idx" ON "financial_reports"("tenantId");
CREATE INDEX IF NOT EXISTS "financial_reports_reportType_idx" ON "financial_reports"("reportType");
CREATE INDEX IF NOT EXISTS "financial_reports_startDate_idx" ON "financial_reports"("startDate");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "financial_attachments" ADD CONSTRAINT "financial_attachments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "cash_flow_projections" ADD CONSTRAINT "cash_flow_projections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "financial_reports" ADD CONSTRAINT "financial_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
