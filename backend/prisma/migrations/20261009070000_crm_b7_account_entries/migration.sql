-- Migration: 20261009070000_crm_b7_account_entries
-- Descrição: Criação das tabelas de Conta Corrente do Cliente (CrmAccountEntry e CrmAccountAllocation)
-- Regra: Imutabilidade estrita garantida por triggers. Não substitui faturação fiscal.

-- 1. Tabela de Lançamentos de Conta Corrente
CREATE TABLE IF NOT EXISTS "crm_account_entries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" TEXT NOT NULL,
  "externalDocumentNumber" TEXT,
  "dueDate" TIMESTAMP(3),
  "amountCents" INTEGER NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "proposalId" TEXT,
  "reversesEntryId" TEXT,
  "createdBy" TEXT,
  "isReversed" BOOLEAN NOT NULL DEFAULT false,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_account_entries_pkey" PRIMARY KEY ("id")
);

-- Índices de consulta rápida por tenant, empresa, data e estornos
CREATE INDEX IF NOT EXISTS "crm_account_entries_tenantId_companyId_idx" ON "crm_account_entries"("tenantId", "companyId");
CREATE INDEX IF NOT EXISTS "crm_account_entries_tenantId_entryDate_idx" ON "crm_account_entries"("tenantId", "entryDate");
CREATE INDEX IF NOT EXISTS "crm_account_entries_tenantId_type_idx" ON "crm_account_entries"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "crm_account_entries_reversesEntryId_idx" ON "crm_account_entries"("reversesEntryId");

-- 2. Tabela de Alocações entre Pagamentos e Documentos
CREATE TABLE IF NOT EXISTS "crm_account_allocations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "paymentEntryId" TEXT NOT NULL,
  "documentEntryId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "isCancelled" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_account_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_account_allocations_tenantId_companyId_idx" ON "crm_account_allocations"("tenantId", "companyId");
CREATE INDEX IF NOT EXISTS "crm_account_allocations_paymentEntryId_idx" ON "crm_account_allocations"("paymentEntryId");
CREATE INDEX IF NOT EXISTS "crm_account_allocations_documentEntryId_idx" ON "crm_account_allocations"("documentEntryId");

-- 3. Chaves estrangeiras com segurança ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_entries_tenantId_fkey') THEN
    ALTER TABLE "crm_account_entries"
    ADD CONSTRAINT "crm_account_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_entries_companyId_fkey') THEN
    ALTER TABLE "crm_account_entries"
    ADD CONSTRAINT "crm_account_entries_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_entries_proposalId_fkey') THEN
    ALTER TABLE "crm_account_entries"
    ADD CONSTRAINT "crm_account_entries_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "crm_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_entries_reversesEntryId_fkey') THEN
    ALTER TABLE "crm_account_entries"
    ADD CONSTRAINT "crm_account_entries_reversesEntryId_fkey"
    FOREIGN KEY ("reversesEntryId") REFERENCES "crm_account_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_allocations_tenantId_fkey') THEN
    ALTER TABLE "crm_account_allocations"
    ADD CONSTRAINT "crm_account_allocations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_allocations_companyId_fkey') THEN
    ALTER TABLE "crm_account_allocations"
    ADD CONSTRAINT "crm_account_allocations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_allocations_paymentEntryId_fkey') THEN
    ALTER TABLE "crm_account_allocations"
    ADD CONSTRAINT "crm_account_allocations_paymentEntryId_fkey"
    FOREIGN KEY ("paymentEntryId") REFERENCES "crm_account_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_account_allocations_documentEntryId_fkey') THEN
    ALTER TABLE "crm_account_allocations"
    ADD CONSTRAINT "crm_account_allocations_documentEntryId_fkey"
    FOREIGN KEY ("documentEntryId") REFERENCES "crm_account_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Funções e Triggers de Imutabilidade
CREATE OR REPLACE FUNCTION trg_crm_account_entry_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lançamentos de conta corrente são imutáveis e não podem ser apagados. Utilize um estorno (REVERSAL).';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Apenas é permitido alterar isReversed e reversedAt quando um estorno é aplicado
    IF (OLD.amountCents != NEW.amountCents OR
        OLD.type != NEW.type OR
        OLD.companyId != NEW.companyId OR
        OLD.tenantId != NEW.tenantId OR
        OLD.entryDate != NEW.entryDate OR
        COALESCE(OLD.externalDocumentNumber, '') != COALESCE(NEW.externalDocumentNumber, '')) THEN
      RAISE EXCEPTION 'Dados fundamentais do lançamento de conta corrente são imutáveis. Utilize um estorno (REVERSAL).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_account_entry_guard ON "crm_account_entries";
CREATE TRIGGER trg_crm_account_entry_guard
BEFORE UPDATE OR DELETE ON "crm_account_entries"
FOR EACH ROW EXECUTE FUNCTION trg_crm_account_entry_immutable();

CREATE OR REPLACE FUNCTION trg_crm_account_alloc_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Alocações de conta corrente são imutáveis e não podem ser apagadas. Cancele o estorno correspondente.';
  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.amountCents != NEW.amountCents OR
        OLD.paymentEntryId != NEW.paymentEntryId OR
        OLD.documentEntryId != NEW.documentEntryId OR
        OLD.companyId != NEW.companyId OR
        OLD.tenantId != NEW.tenantId) THEN
      RAISE EXCEPTION 'Dados de alocação são imutáveis.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_account_alloc_guard ON "crm_account_allocations";
CREATE TRIGGER trg_crm_account_alloc_guard
BEFORE UPDATE OR DELETE ON "crm_account_allocations"
FOR EACH ROW EXECUTE FUNCTION trg_crm_account_alloc_immutable();
