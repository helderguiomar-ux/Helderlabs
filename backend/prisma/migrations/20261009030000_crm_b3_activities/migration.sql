-- ============================================================================
-- Migração Fase B3 — Atividades, Tarefas, Histórico Comercial e Follow-ups
-- Módulo: CRM Enterprise (HelderLabs ERP)
-- Operações aditivas e idempotentes (IF NOT EXISTS)
-- ============================================================================

-- 1. Novas colunas na tabela de comunicações/atividades
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "priority" TEXT DEFAULT 'NORMAL';

-- 2. Índices de performance para timeline e follow-ups
CREATE INDEX IF NOT EXISTS "communications_companyId_idx" ON "communications"("companyId");
CREATE INDEX IF NOT EXISTS "communications_contactId_idx" ON "communications"("contactId");
CREATE INDEX IF NOT EXISTS "communications_opportunityId_idx" ON "communications"("opportunityId");
CREATE INDEX IF NOT EXISTS "communications_status_idx" ON "communications"("status");
CREATE INDEX IF NOT EXISTS "communications_dueDate_idx" ON "communications"("dueDate");
CREATE INDEX IF NOT EXISTS "communications_deletedAt_idx" ON "communications"("deletedAt");

-- 3. Foreign Keys relacionais protegidas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communications_companyId_fkey'
  ) THEN
    ALTER TABLE "communications" ADD CONSTRAINT "communications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communications_contactId_fkey'
  ) THEN
    ALTER TABLE "communications" ADD CONSTRAINT "communications_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_company_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'communications_opportunityId_fkey'
  ) THEN
    ALTER TABLE "communications" ADD CONSTRAINT "communications_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
