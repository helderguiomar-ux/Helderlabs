# FASE 3 — MODELO ALVO E PLANO DE ARQUITETURA HCCALL (HelderLabs ERP)

> **Destinatário:** Validação Técnica e Gate de Aprovação  
> **Estado:** AGUARDANDO VALIDAÇÃO EXPLÍCITA (Não avançar para Fase 4 sem aprovação)  
> **Versão Alvo:** 2.0.0-PROD-READY

---

## 3.1 ISOLAMENTO MULTI-TENANT (Defesa em Profundidade #1)

### 3.1.1 Esquema e Constraints na Base de Dados
1. **`tenant_id NOT NULL` em Todas as Tabelas:**
   - Adicionar ou manter a coluna `tenant_id` (ou `tenantId`) como `NOT NULL` em todas as tabelas de negócio do HCCALL (`hccall_sales`, `hccall_sale_items`, `hccall_sale_events`, `hccall_services`, `hccall_service_tiers`, `hccall_campaigns`, `hccall_customers`, `hccall_counters`, `tenant_company_profile`).
2. **Foreign Keys Formais para `tenants(id)`:**
   - Criar foreign key com `ON DELETE RESTRICT` em todas as tabelas de negócio:
     ```sql
     ALTER TABLE "hccall_sales" ADD CONSTRAINT "fk_hccall_sales_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
     ALTER TABLE "hccall_services" ADD CONSTRAINT "fk_hccall_services_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
     ALTER TABLE "hccall_service_tiers" ADD CONSTRAINT "fk_hccall_service_tiers_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
     ALTER TABLE "hccall_campaigns" ADD CONSTRAINT "fk_hccall_campaigns_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
     ALTER TABLE "hccall_sale_events" ADD CONSTRAINT "fk_hccall_sale_events_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT;
     ```
3. **Índices Compostos Começados por `tenantId`:**
   - Garantir que todos os índices secundários e de consulta começam pelo discriminador de tenant (ex.: `("tenantId", "soldAt")`, `("tenantId", "serviceId")`, `("tenantId", "status")`).
4. **Row-Level Security (RLS) no PostgreSQL:**
   - Ativar RLS em todas as tabelas de negócio:
     ```sql
     ALTER TABLE "hccall_sales" ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation_policy ON "hccall_sales"
       USING ("tenantId" = current_setting('app.current_tenant', true))
       WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
     ```
   - O middleware transacional define `SET LOCAL app.current_tenant = :tenantId` antes de cada operação, garantindo que o PostgreSQL bloqueia acessos indevidos mesmo em caso de falha da camada aplicacional.
5. **Chaves Primárias Não-Sequenciais (UUID / CUID Seguro):**
   - Eliminação completa de IDs sequenciais em entidades de negócio para impedir enumeração e IDOR entre tenants.

### 3.1.2 Camada Aplicacional e Centralização de Acesso
- **Derivação Estrita da Sessão:** O `tenantId` é obtido unicamente do JWT verificado (`req.user.tenantId`).
- **Bloqueio de Injeção com Alerta de Segurança (403):** Se um pedido HTTP contiver um campo `tenantId` divergente no body ou query, o servidor rejeita imediatamente com HTTP 403 e gera um evento de auditoria de categoria `SECURITY` (`SECURITY_TENANT_TAMPER_ATTEMPT`).
- **Acesso Centralizado:** Nenhuma rota constrói queries cruas; todas passam pelo cliente gerado por `forTenant(tenantId)` e repositórios tipados.

---

## 3.2 UTILIZADORES, PAPÉIS E MATRIZ CRUD DINÂMICA (Requisito #4)

### 3.2.1 Modelo de Dados RBAC
Tabelas:
- **`tenant_users`**: `id, tenant_id, user_id, role_id, status ('active'|'suspended'), created_at, updated_at`
- **`roles`**: `id, tenant_id, name, slug, description, is_system, created_at, updated_at`
- **`permissions`**: `id, resource, action, scope, description`
- **`role_permissions`**: `id, role_id, permission_id, created_at`

### 3.2.2 Definição de Permissão: Recurso × Ação × Âmbito
- **Ações:** `create`, `read`, `update`, `delete`, `export`, `approve`, `configure`
- **Âmbitos:**
  - `own`: Aplica-se exclusivamente aos registos criados pelo próprio utilizador autenticado (`ownerUserId = req.user.id`).
  - `tenant`: Aplica-se a todos os registos do tenant.

### 3.2.3 Matriz Base de Papéis (Editável pelo Tenant)

| Papel | Vendas | Serviços & Escalões | Campanhas | Utilizadores & Papéis | Auditoria | Backup & Restauro |
|---|---|---|---|---|---|---|
| **Owner** | CRUD (tenant) | CRUD (tenant) | CRUD (tenant) | CRUD (tenant) | read / export (tenant) | create / restore |
| **Admin** | CRUD (tenant) | CRUD (tenant) | CRUD (tenant) | CRU (tenant) | read / export (tenant) | create |
| **Gestor** | CRU (tenant), D (own) | read (tenant) | CRU (tenant) | read (tenant) | read (tenant) | — |
| **Utilizador** | CRUD (own) | read (tenant) | read (tenant) | — | read (own) | — |
| **Leitor** | read (tenant) | read (tenant) | read (tenant) | — | — | — |

### 3.2.4 Validação Server-Side Fail-Closed
- Cada rota declara explicitamente a permissão exigida através do guard `app.requirePermission(resource, action)`.
- Qualquer rota privada sem declaração explícita de permissão falha no arranque do servidor (`Fail-Closed by Design`).

---

## 3.3 MODELO DE NEGÓCIO DO HCCALL (Esquema Canónico Adaptado)

### 3.3.1 Tabelas e Estruturas de Dados

#### 1. `hccall_services` (Serviços Vendáveis)
```sql
CREATE TABLE "hccall_services" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "codigo" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "comissao_tipo" TEXT NOT NULL CHECK ("comissao_tipo" IN ('fixo', 'percentual')),
  "comissao_valor" INTEGER NOT NULL DEFAULT 0, -- em cêntimos ou basis points
  "objetivo_mensal_qtd" INTEGER NOT NULL DEFAULT 0,
  "objetivo_mensal_valor" INTEGER NOT NULL DEFAULT 0,
  "bonus_mode" TEXT NOT NULL DEFAULT 'milestone' CHECK ("bonus_mode" IN ('milestone', 'accumulate')),
  "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_to" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,
  CONSTRAINT "hccall_services_tenant_codigo_key" UNIQUE ("tenantId", "codigo")
);
```

#### 2. `hccall_service_tiers` (Escalões e Bónus do Serviço)
```sql
CREATE TABLE "hccall_service_tiers" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "serviceId" TEXT NOT NULL REFERENCES "hccall_services"("id") ON DELETE CASCADE,
  "ordem" INTEGER NOT NULL,
  "limiar_qtd" INTEGER NOT NULL DEFAULT 0,
  "limiar_valor" INTEGER NOT NULL DEFAULT 0,
  "bonus_valor" INTEGER NOT NULL DEFAULT 0, -- em cêntimos
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

> **Regra de Bónus (`bonus_mode`):**
> - `milestone`: Aplica-se **apenas** o bónus do escalão mais alto atingido no período.
> - `accumulate`: Somam-se os bónus de **todos** os escalões atingidos no período.
> O modo de bónus é capturado no snapshot de cálculo da comissão de cada mês para garantir que alterações futuras de configuração não adulterem comissões históricas.

#### 3. `hccall_campaigns` (Dinamizações e Campanhas Temporárias)
```sql
CREATE TABLE "hccall_campaigns" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "nome" TEXT NOT NULL,
  "periodo_inicio" TIMESTAMP(3) NOT NULL,
  "periodo_fim" TIMESTAMP(3),
  "condicoes" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "multiplicador" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "bonus_fixo_cents" INTEGER NOT NULL DEFAULT 0,
  "servicos_abrangidos" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3)
);
```

#### 4. `hccall_sales` (Vendas e Registos Comerciais)
```sql
CREATE TABLE "hccall_sales" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "serviceId" TEXT NOT NULL REFERENCES "hccall_services"("id") ON DELETE RESTRICT,
  "campaignId" TEXT REFERENCES "hccall_campaigns"("id") ON DELETE SET NULL,
  "code" TEXT NOT NULL, -- VND-YYYY-XXXXX
  "clientUuid" TEXT NOT NULL,
  "cliente_ref" TEXT NOT NULL,
  "cliente_nome" TEXT,
  "cliente_telefone" TEXT,
  "valor" INTEGER NOT NULL DEFAULT 0, -- em cêntimos
  "quantidade" INTEGER NOT NULL DEFAULT 1,
  "data_venda" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('scheduled', 'closed', 'cancelled')),
  "scheduled_confirmed_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "is_backdated" BOOLEAN NOT NULL DEFAULT false,
  "comissao_estimada" INTEGER NOT NULL DEFAULT 0,
  "comissao_validada" INTEGER NOT NULL DEFAULT 0,
  "comissao_paga" INTEGER NOT NULL DEFAULT 0,
  "comissao_calc_snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "deleteReason" TEXT,
  CONSTRAINT "hccall_sales_tenant_clientUuid_key" UNIQUE ("tenantId", "clientUuid")
);
```

#### 5. `hccall_sale_events` (Histórico de Negócio da Ficha da Venda)
```sql
CREATE TABLE "hccall_sale_events" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "saleId" TEXT NOT NULL REFERENCES "hccall_sales"("id") ON DELETE CASCADE,
  "action" TEXT NOT NULL, -- 'CREATED', 'UPDATED', 'TRANSITIONED', 'SOFT_DELETED'
  "actorUserId" TEXT NOT NULL,
  "beforeState" JSONB,
  "afterState" JSONB NOT NULL,
  "reason" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### 6. `tenant_company_profile` (Perfil da Empresa)
```sql
CREATE TABLE "tenant_company_profile" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
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
  "updatedAt" TIMESTAMP(3) NOT NULL
);
```

---

## 3.4 MÁQUINA DE ESTADOS DA VENDA E FLUXO DE REGISTO

1. **Venda com `data_venda == hoje`:**
   - Gravada diretamente com `status = 'closed'`, `closed_at = now()`, `is_backdated = false`.
2. **Venda com `data_venda > hoje` (Venda Futura / Agendada):**
   - A UI exibe modal bloqueante de confirmação: *"Esta venda fica agendada para DD/MM e só conta para objetivos e comissões a partir dessa data. Confirmar?"*.
   - Apenas é gravada com confirmação explícita (`scheduled_confirmed_at = now()`).
   - Gravada como `status = 'scheduled'`, `closed_at = null`.
   - **Regra de Isolamento de KPIs:** Vendas `scheduled` são **excluídas** de comissões ganhas e objetivos realizados; aparecem exclusivamente no pipeline de previsão.
3. **Transição de `scheduled` para `closed`:**
   - **Job Diário:** Executado às 00:01 UTC para efetuar transição idempotente de todas as vendas cujo `data_venda <= hoje`.
   - **Transição Lazy na Leitura:** Ao consultar vendas ou painel de análise, se existirem vendas `scheduled` com data atingida, o sistema transita-as atomicamente antes de devolver o resultado.
   - Cada transição grava um registo em `hccall_sale_events` e na auditoria global com ator `system`.
4. **Venda com `data_venda < hoje` (Venda Retroativa):**
   - Permitida, gravada como `status = 'closed'`, marcada com `is_backdated = true`, auditada e assinalada visualmente nas análises com badge de venda retroativa.
5. **Edição e Eliminação:**
   - Edição de campos críticos recalcula a comissão através da função pura, grava novo snapshot e regista evento com antes/depois em `hccall_sale_events`.
   - Eliminação exige motivo (`deleteReason`) com pelo menos 10 caracteres e identificação do ator (`deletedBy`).

---

## 3.5 MOTOR DE COMISSÕES DETERMINÍSTICO E IMUTÁVEL

1. **Função Pura Centralizada:**
   - `calcularComissao(venda, servico, escaloes, campanhas, periodo)` é a **única** fonte de cálculo do sistema.
   - Nenhuma comissão é atribuída arbitrariamente por valores enviados pelo cliente.
2. **Snapshot Criptográfico e Auditável (`comissao_calc_snapshot`):**
   - Cada venda guarda um JSON com:
     ```json
     {
       "engine_version": "2.0.0",
       "calculated_at": "2026-09-13T15:30:00.000Z",
       "base_service_id": "srv_123",
       "base_service_code": "FIBRA_1G",
       "service_bonus_mode": "milestone",
       "applied_tier": { "ordem": 2, "limiar": 10, "valor_cents": 1000 },
       "campaign_applied": { "id": "cmp_456", "name": "Campanha Outono", "multiplier": 1.2 },
       "inputs": { "quantidade": 2, "valor_venda_cents": 7000 },
       "result_commission_cents": 2400
     }
     ```
3. **Ciclo de Vida da Comissão:**
   - `estimada` (venda registada/fechada) ➔ `validada` (aprovação pela chefia/gestor) ➔ `paga` (processamento financeiro).

---

## 3.6 AUDITORIA E HISTÓRICO CANÓNICO (SHA-256 Append-Only)

1. **Garantia de Append-Only na Base de Dados:**
   - Revogar permissões de `UPDATE` e `DELETE` ao utilizador aplicacional na tabela `audit_logs`.
   - Trigger de proteção em PostgreSQL que bloqueia qualquer tentativa de mutação de linhas existentes:
     ```sql
     CREATE OR REPLACE FUNCTION protect_audit_log() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: A tabela audit_logs e estritamente append-only.';
     END;
     $$ LANGUAGE plpgsql;

     CREATE TRIGGER audit_log_no_mutation
     BEFORE UPDATE OR DELETE ON "audit_logs"
     FOR EACH ROW EXECUTE FUNCTION protect_audit_log();
     ```
2. **Génese Canónica e Sequência por Tenant:**
   - A verificação de integridade valida `prevHash = '0'.repeat(64)` no primeiro registo cronológico de cada tenant.
   - `seq` passa a ser calculado de forma contígua por partição de tenant (`seq_per_tenant`).
3. **Cobertura de 100% das Mutações:**
   - Hook global no Fastify regista automaticamente eventos de auditoria para **todas** as operações `POST`, `PUT`, `PATCH`, `DELETE` e tentativas negadas (403/401).
4. **Transparência de Re-selagem (`repairChain`):**
   - Exige motivo obrigatório (mínimo 20 caracteres), armazena o dump anterior integral em `audit_chain_reseals` e marca a partição como re-selada.

---

## 3.7 BACKUP, EXPORTAÇÃO E RESTAURO VERIFICADO

1. **Backup por Tenant:**
   - Formato neutro NDJSON por tabela com compressão gzip.
   - Ficheiro `manifest.json` contendo:
     - Versão do schema e timestamp UTC;
     - Contagem exata de linhas por tabela;
     - SHA-256 individual por tabela e SHA-256 consolidado do arquivo;
     - Último `seq` e `hash` da cadeia de auditoria do tenant.
2. **Teste Automatizado Obrigatório de Restauro:**
   - O pipeline de backup executa semanalmente: Exportar ➔ Restaurar em base sandbox temporária ➔ Comparar contagens e hashes criptográficos ➔ Destruir sandbox.
   - **Um backup sem teste de restauro concluído não é classificado como válido.**

---

## 3.8 CONSISTÊNCIA E VERIFICADOR DE INTEGRIDADE

1. **Invariantes na Base de Dados:**
   - `CHECK (quantidade > 0)`, `CHECK (valor >= 0)`, `CHECK (comissao_estimada >= 0)`.
   - `CHECK (closed_at IS NOT NULL)` quando `status = 'closed'`.
   - `CHECK (scheduled_confirmed_at IS NOT NULL)` quando `status = 'scheduled'`.
   - Concorrência protegida por `version` com optimistic locking (HTTP 409 em caso de colisão).
2. **Motor de Verificação de Integridade (`/admin/integridade`):**
   - Executa 7 testes determinísticos:
     1. Integridade da cadeia SHA-256;
     2. Registos sem tenant ou com tenant inexistente;
     3. Registos órfãos;
     4. Duplicados por chave natural;
     5. Comissões armazenadas vs recalculadas;
     6. Vendas agendadas vencidas sem transição;
     7. Contagens de dados vs último backup.
   - Falha crítica ➔ Banner de alerta permanente para o Owner e bloqueio de exportações certificadas.

---

## 3.9 ANÁLISE E DASHBOARDS AUDITÁVEIS

- Separação visual e métrica absoluta entre **Realizado** (`closed`) e **Pipeline** (`scheduled`).
- Realizado vs Objetivo por serviço, categoria e operador.
- Análise de contribuição de campanhas e dinamizações com baseline histórica.
- *Drill-down* universal: qualquer número ou gráfico permite clicar e abrir a lista exata de vendas individuais que compõem o valor.

---

## PLANO DE VERIFICAÇÃO E TRANSIÇÃO (FASE 4 A FASE 8)

Ao receber aprovação, a implementação seguirá os seguintes passos:
1. **Fase 4 (Migrações):** Backup sandbox verificado ➔ Criação de migração idempotente com DDL de constraints, FKs, RLS e triggers ➔ Backfill de dados sem perda.
2. **Fase 5 (Implementação):** Reforço dos repositórios, motor de permissões e serviços.
3. **Fase 6 (Testes com Prova Real):** Testes de isolamento entre tenants A e B, matriz de permissões, recálculo de comissões, stress test e Playwright E2E.
4. **Fase 7 (QA Visual):** Captura de screenshots em desktop e mobile (temas claro e escuro).
5. **Fase 8 (Relatório e Gate):** Relatório final com logs reais para liberação de produção.
