-- AlterTable
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
