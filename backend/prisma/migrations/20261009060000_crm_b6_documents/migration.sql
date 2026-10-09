-- Migration: 20261009060000_crm_b6_documents
-- Descrição: Expansão do modelo de documentos empresariais com isolamento multi-tenant, validação de caducidades, códigos de acesso e estado de verificação.

ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "fileName" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "fileSizeBytes" INTEGER;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "accessCode" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "crm_company_documents" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preencher tenantId nos documentos existentes a partir da empresa correspondente
UPDATE "crm_company_documents" doc
SET "tenantId" = c."tenantId"
FROM "crm_companies" c
WHERE doc."companyId" = c.id AND doc."tenantId" IS NULL;

-- Criar indices de suporte a performance e consultas por tenant/caducidade
CREATE INDEX IF NOT EXISTS "crm_company_documents_tenantId_idx" ON "crm_company_documents"("tenantId");
CREATE INDEX IF NOT EXISTS "crm_company_documents_status_idx" ON "crm_company_documents"("status");
CREATE INDEX IF NOT EXISTS "crm_company_documents_expiryDate_idx" ON "crm_company_documents"("expiryDate");

-- Adicionar FK opcional para tenant caso ainda não exista
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_company_documents_tenantId_fkey'
  ) THEN
    ALTER TABLE "crm_company_documents"
    ADD CONSTRAINT "crm_company_documents_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
