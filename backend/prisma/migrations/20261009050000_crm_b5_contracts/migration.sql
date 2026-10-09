-- Migração aditiva e segura — CRM Fase B5: Gestão de Contratos de Avença, SLA e Renovações Automáticas
-- Data: 2026-10-09
-- Modelos afetados: crm_contracts, crm_proposals

-- 1. Adicionar colunas aditivas à tabela crm_contracts
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "proposalId" TEXT;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "isIndefinite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "monthlyValueCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "slaLevel" TEXT DEFAULT 'STANDARD';
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "slaResponseHours" INTEGER;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "slaResolutionHours" INTEGER;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "renewalNoticeDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "lastRenewedAt" TIMESTAMP(3);
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "termsAndConditions" TEXT;
ALTER TABLE "crm_contracts" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- 2. Inicializar monthlyValueCents para contratos existentes se aplicável
UPDATE "crm_contracts"
SET "monthlyValueCents" = "valueCents"
WHERE "monthlyValueCents" = 0 AND ("billingFrequency" = 'MONTHLY' OR "billingFrequency" IS NULL);

-- 3. Adicionar chave forasteira para crm_proposals com integridade referencial segura (SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_contracts_proposalId_fkey'
  ) THEN
    ALTER TABLE "crm_contracts"
      ADD CONSTRAINT "crm_contracts_proposalId_fkey"
      FOREIGN KEY ("proposalId")
      REFERENCES "crm_proposals"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Adicionar índices de pesquisa por tenant e soft-delete
CREATE INDEX IF NOT EXISTS "crm_contracts_tenantId_contractNumber_idx" ON "crm_contracts"("tenantId", "contractNumber");
CREATE INDEX IF NOT EXISTS "crm_contracts_proposalId_idx" ON "crm_contracts"("proposalId");
CREATE INDEX IF NOT EXISTS "crm_contracts_endDate_idx" ON "crm_contracts"("endDate");
CREATE INDEX IF NOT EXISTS "crm_contracts_deletedAt_idx" ON "crm_contracts"("deletedAt");
