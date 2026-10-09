-- ============================================================================
-- Migração Fase B4 — Propostas Comerciais & Orçamentos (Quotes & Proposals)
-- Módulo: CRM Enterprise (HelderLabs ERP)
-- Operações aditivas e idempotentes (IF NOT EXISTS)
-- ============================================================================

-- 1. CreateEnum ProposalStatus se não existir
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProposalStatus') THEN
    CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');
  END IF;
END $$;

-- 2. Tabela de Propostas Comerciais
CREATE TABLE IF NOT EXISTS "crm_proposals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "vatRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 23.0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "termsAndConditions" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_proposals_pkey" PRIMARY KEY ("id")
);

-- 3. Tabela de Linhas / Itens da Proposta
CREATE TABLE IF NOT EXISTS "crm_proposal_items" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "vatRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 23.0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "crm_proposal_items_pkey" PRIMARY KEY ("id")
);

-- 4. Índices de performance e unicidade
CREATE UNIQUE INDEX IF NOT EXISTS "crm_proposals_tenantId_proposalNumber_key" ON "crm_proposals"("tenantId", "proposalNumber");
CREATE INDEX IF NOT EXISTS "crm_proposals_tenantId_idx" ON "crm_proposals"("tenantId");
CREATE INDEX IF NOT EXISTS "crm_proposals_companyId_idx" ON "crm_proposals"("companyId");
CREATE INDEX IF NOT EXISTS "crm_proposals_opportunityId_idx" ON "crm_proposals"("opportunityId");
CREATE INDEX IF NOT EXISTS "crm_proposals_status_idx" ON "crm_proposals"("status");
CREATE INDEX IF NOT EXISTS "crm_proposals_deletedAt_idx" ON "crm_proposals"("deletedAt");

CREATE INDEX IF NOT EXISTS "crm_proposal_items_proposalId_idx" ON "crm_proposal_items"("proposalId");

-- 5. Chaves estrangeiras com integridade
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_proposals_tenantId_fkey') THEN
    ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_proposals_companyId_fkey') THEN
    ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_proposals_contactId_fkey') THEN
    ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_company_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_proposals_opportunityId_fkey') THEN
    ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_proposal_items_proposalId_fkey') THEN
    ALTER TABLE "crm_proposal_items" ADD CONSTRAINT "crm_proposal_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
