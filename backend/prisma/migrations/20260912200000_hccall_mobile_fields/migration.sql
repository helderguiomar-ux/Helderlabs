-- =============================================================================
-- HCCALL — campos para o registo móvel de vendas
--
-- Estritamente ADITIVA. Três colunas novas, todas com valor por omissão ou
-- anuláveis: nenhuma linha existente é alterada, nenhuma query existente é
-- afetada, e a API anterior continua a funcionar sem conhecer estes campos.
--
-- Pode ser aplicada antes do deploy do frontend.
-- =============================================================================

-- Comissão por omissão de cada serviço. É o valor aplicado quando a venda não
-- cai em nenhuma dinamização activa.
ALTER TABLE "hccall_products"
  ADD COLUMN IF NOT EXISTS "defaultCommissionCents" INTEGER NOT NULL DEFAULT 0;

-- Comissão fixa por venda abrangida por uma dinamização.
-- O HccallCommissionEngine já suportava este conceito (baseAmountPerSaleCents);
-- faltava a coluna que permitisse configurá-lo.
ALTER TABLE "hccall_dynamizations"
  ADD COLUMN IF NOT EXISTS "baseAmountPerSaleCents" INTEGER NOT NULL DEFAULT 0;

-- Número de ordem no sistema do operador. Distinto de "code" (referência
-- interna gerada pelo HCCALL) e de "customerNumber" (identificação do cliente).
ALTER TABLE "hccall_sales"
  ADD COLUMN IF NOT EXISTS "orderNumber" TEXT;

CREATE INDEX IF NOT EXISTS "hccall_sales_tenant_order_idx"
  ON "hccall_sales" ("tenantId", "orderNumber");
