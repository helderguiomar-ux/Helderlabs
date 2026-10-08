-- CRM B1 — Fundações e Segurança (aditiva, idempotente)

-- CreateEnum DecisionPower
DO $$ BEGIN
  CREATE TYPE "DecisionPower" AS ENUM ('DECISOR', 'INFLUENCIADOR', 'UTILIZADOR', 'OUTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable crm_company_contacts: add decisionPower
ALTER TABLE "crm_company_contacts" ADD COLUMN IF NOT EXISTS "decisionPower" "DecisionPower";

-- AlterTable crm_company_relations: add deletedAt
ALTER TABLE "crm_company_relations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_company_relations_deletedAt_idx" ON "crm_company_relations"("deletedAt");
