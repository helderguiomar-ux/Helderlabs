-- Migration: 20260913214500_add_product_id_to_hccall_objectives
-- Adiciona coluna productId e respetivo indice para permitir metas por servico

ALTER TABLE "hccall_objectives" ADD COLUMN IF NOT EXISTS "productId" TEXT;

CREATE INDEX IF NOT EXISTS "hccall_objectives_tenant_product_idx" ON "hccall_objectives" ("tenantId", "productId");
