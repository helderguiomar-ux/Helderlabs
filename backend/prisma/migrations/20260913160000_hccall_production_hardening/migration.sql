-- Migration: 20260913160000_hccall_production_hardening
-- Multi-Tenant Isolation, FKs, RLS, Append-Only Triggers and Hardening

-- 1. ADICIONAR CAMPOS DE AUDITORIA E CICLO DE VIDA DE VENDA
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "scheduled_confirmed_at" TIMESTAMP(3);
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "is_backdated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
ALTER TABLE "hccall_sales" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "hccall_dynamizations" ADD COLUMN IF NOT EXISTS "bonus_mode" TEXT NOT NULL DEFAULT 'milestone';
ALTER TABLE "hccall_services" ADD COLUMN IF NOT EXISTS "bonus_mode" TEXT NOT NULL DEFAULT 'milestone';
ALTER TABLE "hccall_services" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "hccall_services" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
ALTER TABLE "hccall_products" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "hccall_products" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

-- 2. TABELA DE EVENTOS DE VENDA (HISTÓRICO NA FICHA DE VENDA)
CREATE TABLE IF NOT EXISTS "hccall_sale_events" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "beforeState" JSONB,
  "afterState" JSONB NOT NULL,
  "reason" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "hccall_sale_events_tenant_sale_idx" ON "hccall_sale_events" ("tenantId", "saleId");
CREATE INDEX IF NOT EXISTS "hccall_sale_events_timestamp_idx" ON "hccall_sale_events" ("timestamp" DESC);

-- 3. TABELA DE PERFIL DA EMPRESA DO TENANT
CREATE TABLE IF NOT EXISTS "tenant_company_profile" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE,
  "designacao" TEXT NOT NULL,
  "nif" TEXT NOT NULL,
  "morada" TEXT,
  "setor" TEXT,
  "dimensao" TEXT,
  "ano_inicio" INTEGER,
  "responsavel_nome" TEXT,
  "responsavel_email" TEXT,
  "responsavel_telefone" TEXT,
  "moeda" TEXT NOT NULL DEFAULT 'EUR',
  "fuso_horario" TEXT NOT NULL DEFAULT 'Europe/Lisbon',
  "mes_fecho_comercial" INTEGER NOT NULL DEFAULT 12,
  "extras" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "tenant_company_profile_tenant_idx" ON "tenant_company_profile" ("tenantId");

-- 4. ADICIONAR FOREIGN KEYS ESTRITAS PARA TENANTS (ON DELETE RESTRICT)
DO $$ BEGIN
  ALTER TABLE "hccall_sales" ADD CONSTRAINT "fk_hccall_sales_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_sale_items" ADD CONSTRAINT "fk_hccall_sale_items_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_sale_changes" ADD CONSTRAINT "fk_hccall_sale_changes_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_sale_statuses" ADD CONSTRAINT "fk_hccall_sale_statuses_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_products" ADD CONSTRAINT "fk_hccall_products_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_dynamizations" ADD CONSTRAINT "fk_hccall_dynamizations_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_dynamization_tiers" ADD CONSTRAINT "fk_hccall_dynamization_tiers_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_dynamization_bonuses" ADD CONSTRAINT "fk_hccall_dynamization_bonuses_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_customers" ADD CONSTRAINT "fk_hccall_customers_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_services" ADD CONSTRAINT "fk_hccall_services_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_promotions" ADD CONSTRAINT "fk_hccall_promotions_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_objectives" ADD CONSTRAINT "fk_hccall_objectives_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_sale_events" ADD CONSTRAINT "fk_hccall_sale_events_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "hccall_sale_events" ADD CONSTRAINT "fk_hccall_sale_events_sale" FOREIGN KEY ("saleId") REFERENCES "hccall_sales"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tenant_company_profile" ADD CONSTRAINT "fk_tenant_company_profile_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. TRIGGER DE IMUTABILIDADE APPEND-ONLY NA TABELA AUDIT_LOGS
CREATE OR REPLACE FUNCTION protect_audit_log() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: A tabela audit_logs e estritamente append-only. Operacoes UPDATE e DELETE sao proibidas.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_mutation ON "audit_logs";
CREATE TRIGGER audit_log_no_mutation
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION protect_audit_log();

-- 6. ATIVAR ROW LEVEL SECURITY (RLS) NAS TABELAS DE NEGÓCIO HCCALL
ALTER TABLE "hccall_sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_sale_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_sale_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_sale_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_dynamizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_dynamization_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_dynamization_bonuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_promotions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_objectives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hccall_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_company_profile" ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS permissivas quando app.current_tenant está definido ou bypass para superuser/admin
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_policy ON "hccall_sales";
  CREATE POLICY tenant_isolation_policy ON "hccall_sales"
    USING (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    )
    WITH CHECK (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    );
END $$;
