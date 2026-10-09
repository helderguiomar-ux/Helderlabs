-- Migration 20261009020000_crm_b2_pipeline
-- Adiciona campos de suporte a Pipeline e Funil Comercial ao modelo Opportunity

ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "expectedCloseDate" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "opportunities_companyId_idx" ON "opportunities"("companyId");
CREATE INDEX IF NOT EXISTS "opportunities_contactId_idx" ON "opportunities"("contactId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_companyId_fkey'
  ) THEN
    ALTER TABLE "opportunities"
      ADD CONSTRAINT "opportunities_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_contactId_fkey'
  ) THEN
    ALTER TABLE "opportunities"
      ADD CONSTRAINT "opportunities_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "crm_company_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
