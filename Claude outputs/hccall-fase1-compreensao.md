# FASE 1 — COMPREENSÃO INTEGRAL DO MÓDULO HCCALL (HelderLabs ERP)

> **Data da Extração:** 2026-09-13  
> **Ambiente:** PostgreSQL de Produção / Staging (`helderlabs-erp` v1.4.0)  
> **Objetivo:** Radiografia técnica completa, empírica e verificável do módulo HCCALL e das suas dependências estruturais na plataforma HelderLabs ERP.

---

## 1.1 INVENTÁRIO DO MÓDULO HCCALL

### 1.1.1 Ficheiros do Backend
| Ficheiro | Linhas | Propósito / Responsabilidade |
|---|---|---|
| `backend/src/modules/hccall/routes/hccall.routes.ts` | 85 | Declaração de rotas Fastify protegidas por `app.authenticate` e `app.requireApp('hccall')`. |
| `backend/src/modules/hccall/controllers/HccallController.ts` | 665 | Controlador HTTP (validação Zod, extração de sessão, invocação de serviços e broadcast SSE). |
| `backend/src/modules/hccall/services/HccallSaleService.ts` | 415 | CRUD transacional de vendas, numeração sequencial de fatura/venda, snapshots e IDOR checks. |
| `backend/src/modules/hccall/services/HccallCommissionEngine.ts` | 382 | Motor determinístico de cálculo de comissões por escalões (`RETROACTIVE`, `MARGINAL`, `FLAT`) e bónus. |
| `backend/src/modules/hccall/services/HccallDynamizationService.ts` | 185 | Gestão de campanhas e dinamizações comerciais com escalões (`tiers`) e bónus (`bonuses`). |
| `backend/src/modules/hccall/services/HccallProductService.ts` | 82 | Catálogo de produtos/serviços vendáveis e comissões base. |
| `backend/src/modules/hccall/services/HccallObjectiveService.ts` | 248 | Definição e monitorização de objetivos periódicos e projeções de ritmo. |
| `backend/src/modules/hccall/services/HccallPerformanceService.ts` | 158 | Agregação de métricas de performance diária/mensal, ritmo comercial e projeção de fecho. |
| `backend/src/modules/hccall/services/HccallAlertService.ts` | 172 | Alertas determinísticos (início/fim de dinamizações, desvio de ritmo de objetivos). |
| `backend/src/modules/hccall/services/HccallConfigService.ts` | 290 | Serviços de retrocompatibilidade v1 (`HccallService`, `HccallPromotion`, `HccallSaleStatus`). |
| `backend/src/modules/hccall/services/HccallCustomerService.ts` | 125 | Gestão simplificada de clientes, histórico de contactos e anonimização RGPD. |
| `backend/src/modules/hccall/services/HccallCounterService.ts` | 32 | Geração transacional de código de venda (`VND-YYYY-XXXXX`) via tabela `hccall_counters`. |
| `backend/src/modules/hccall/services/HccallOrgContextService.ts` | 68 | Gestão do contexto organizacional do operador (empresa, local de trabalho, função). |
| `backend/src/modules/hccall/services/HccallScopeService.ts` | 26 | Resolução de âmbito de visibilidade (`OWN` para utilizadores normais, `ALL` para admins/managers). |
| `backend/src/modules/hccall/services/HccallSyncService.ts` | 115 | Processamento e reconciliação idempotente de lotes de vendas criadas offline (`clientUuid`). |
| `backend/src/modules/hccall/module.manifest.ts` | 15 | Manifesto de metadados, permissões e versão da aplicação HCCALL. |

### 1.1.2 Ficheiros de UI / Frontend
| Ficheiro | Linhas | Propósito / Responsabilidade |
|---|---|---|
| `backend/public/hccall.html` | 1513 | SPA mobile-first com suporte a Desktop responsivo, gestão de tema claro/escuro, ecrãs de registo, listagem, gráficos SVG, simulação e definições. |
| `backend/public/hccall-sw.js` | 42 | Service Worker para capacidades offline e cache local de assets do HCCALL. |
| `backend/public/hccall.webmanifest` | 16 | Manifesto PWA (nome, ícones, cores temáticas, modo standalone). |

### 1.1.3 Rotas e Endpoints HTTP
Todas as rotas estão prefixadas por `/api/hccall` e exigem autenticação JWT + atribuição da aplicação `hccall`:
- **Contexto Organizacional:**
  - `GET /api/hccall/context` — Consulta contexto de trabalho ativo.
  - `POST /api/hccall/context/switch` — Alterna contexto organizacional do operador.
- **Catálogo de Produtos:**
  - `GET /api/hccall/products` — Listagem de produtos do catálogo.
  - `POST /api/hccall/products` — Criação de produto com comissão base.
  - `PUT /api/hccall/products/:id` — Atualização de produto.
  - `DELETE /api/hccall/products/:id` — Soft-delete / desativação de produto.
- **Dinamizações & Campanhas:**
  - `GET /api/hccall/dynamizations` — Listagem de dinamizações ativas e arquivadas.
  - `POST /api/hccall/dynamizations` — Criação de dinamização com escalões e bónus.
  - `GET /api/hccall/dynamizations/:id` — Consulta de detalhe com histórico.
  - `PUT /api/hccall/dynamizations/:id` — Atualização de dinamização.
  - `DELETE /api/hccall/dynamizations/:id` — Arquivo de dinamização com preservação de vendas históricas.
- **Vendas (Operação Central):**
  - `GET /api/hccall/sales` — Listagem paginada com filtros por estado, dinamização, data e pesquisa.
  - `POST /api/hccall/sales` — Registo de venda (idempotente via `clientUuid`, numeração atómica).
  - `GET /api/hccall/sales/:id` — Ficha detalhada da venda com itens e histórico de alterações.
  - `PUT /api/hccall/sales/:id` — Edição de venda (grava `hccall_sale_changes` com antes/depois).
  - `DELETE /api/hccall/sales/:id` — Soft delete da venda (`deletedAt = now()`).
- **Objetivos Comerciais & Performance:**
  - `GET /api/hccall/objectives` — Listagem de objetivos e progresso.
  - `POST /api/hccall/objectives` — Criação de objetivo.
  - `PUT /api/hccall/objectives/:id` — Atualização de objetivo.
  - `DELETE /api/hccall/objectives/:id` — Eliminação de objetivo.
  - `GET /api/hccall/performance` — Painel consolidado de KPIs (ritmo diário, projeção de mês).
- **Alertas & Simulação:**
  - `GET /api/hccall/alerts` — Consulta de alertas determinísticos calculados.
  - `DELETE /api/hccall/alerts/:id` — Descarte de alerta lido.
  - `POST /api/hccall/simulate` — Simulação determinística "E se fizer mais N vendas?".
- **Offline & Tempo Real:**
  - `POST /api/hccall/sync` — Sincronização offline em lote idempotente.
  - `GET /api/hccall/events` — Server-Sent Events (SSE) para atualização em tempo real no desktop.
- **Relatórios & Retrocompatibilidade v1:**
  - `GET /api/hccall/services` (CRUD em `/services/:id`) — Serviços legados v1.
  - `GET /api/hccall/promotions` (CRUD em `/promotions/:id`) — Promoções legadas v1.
  - `GET /api/hccall/statuses` (CRUD em `/statuses/:id`) — Estados de venda configuráveis.
  - `GET /api/hccall/customers` (detalhe, contactos, anonimização) — Gestão de clientes.
  - `GET /api/hccall/dashboard` / `GET /api/hccall/reports/commissions` — Agregação financeira.
  - `GET /api/hccall/export` / `GET /api/hccall/reports/export.csv` — Exportação CSV com BOM UTF-8.

### 1.1.4 Jobs e Tarefas em Segundo Plano
- Não existem cron jobs independentes ativos em processo separado; a agregação de ritmo e a verificação de alertas são executadas *on-demand* na invocação dos endpoints (`HccallPerformanceService.getPerformanceMetrics`, `HccallAlertService.evaluateAndSyncAlerts`).
- O processamento de transição de vendas agendadas para fechadas está pendente de implementação na Fase 3.

### 1.1.5 Dependências do Módulo
- `@prisma/client` (v5.22.0) — ORM de acesso à base de dados.
- `fastify` (v4.28.1) — Framework HTTP.
- `zod` (v3.23.8) — Validação estrita de esquemas e payloads.
- `crypto` (Node.js nativo) — Hashing SHA-256 e UUIDs.

---

## 1.2 ESQUEMA REAL DE BASE DE DADOS (Extraído do PostgreSQL)

O módulo HCCALL interage com **19 tabelas diretas** no schema `public`, mais as tabelas fundamentais de tenancy, utilizadores e auditoria.

### 1.2.1 Tabelas de Negócio HCCALL

#### 1. `hccall_sales` (5 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `ownerUserId` (text, NOT NULL), `orgContextId` (text, NULL), `code` (text, NOT NULL), `clientUuid` (text, NULL), `customerId` (text, NULL), `customerNumber` (text, NOT NULL), `customerName` (text, NULL), `customerPhone` (text, NULL), `orderNumber` (text, NULL), `serviceName` (text, NOT NULL), `serviceId` (text, NULL), `promotionId` (text, NULL), `promotionName` (text, NULL), `promotionVersion` (integer, NULL), `promotionSnapshot` (jsonb, NULL), `dynamizationId` (text, NULL), `dynamizationSnapshot` (jsonb, NULL), `quantity` (integer, NOT NULL, default 1), `saleValueCents` (integer, NOT NULL, default 0), `commissionCents` (integer, NOT NULL, default 0), `statusId` (text, NOT NULL), `commissionState` (text, NOT NULL, default `'FORECAST'`), `soldAt` (timestamp(3), NOT NULL), `notes` (text, NULL), `deletedAt` (timestamp(3), NULL), `createdAt` (timestamp(3), NOT NULL), `updatedAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_sales_pkey` (PRIMARY KEY `id`), `hccall_sales_tenantId_clientUuid_key` (UNIQUE `tenantId, clientUuid`).
- **Índices:** `hccall_sales_tenantId_soldAt_idx`, `hccall_sales_tenantId_code_idx`, `hccall_sales_tenantId_statusId_idx`, `hccall_sales_tenantId_customerId_idx`, `hccall_sales_tenant_order_idx` (`tenantId, orderNumber`), `hccall_sales_tenantId_deletedAt_idx`.
- **Foreign Keys:** Nenhuma FK explícita na BD para `tenants(id)` ou `users(id)`.
- **Triggers:** Nenhum trigger na BD.

#### 2. `hccall_sale_items` (0 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `saleId` (text, NOT NULL), `productId` (text, NOT NULL), `quantity` (integer, NOT NULL, default 1), `unitPriceCents` (integer, NOT NULL, default 0), `totalPriceCents` (integer, NOT NULL, default 0), `createdAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_sale_items_pkey` (PRIMARY KEY `id`), `hccall_sale_items_saleId_fkey` (FOREIGN KEY `saleId` REFERENCES `hccall_sales(id)` ON DELETE CASCADE), `hccall_sale_items_productId_fkey` (FOREIGN KEY `productId` REFERENCES `hccall_products(id)`).
- **Índices:** `hccall_sale_items_tenantId_saleId_idx`.

#### 3. `hccall_sale_changes` (5 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `saleId` (text, NOT NULL), `field` (text, NOT NULL), `oldValue` (text, NULL), `newValue` (text, NULL), `reason` (text, NOT NULL), `changedByUserId` (text, NOT NULL), `changedAt` (timestamp(3), NOT NULL, default `CURRENT_TIMESTAMP`).
- **Constraints:** `hccall_sale_changes_pkey` (PRIMARY KEY `id`), `hccall_sale_changes_saleId_fkey` (FOREIGN KEY `saleId` REFERENCES `hccall_sales(id)` ON DELETE CASCADE).
- **Índices:** `hccall_sale_changes_tenantId_saleId_idx`.

#### 4. `hccall_products` (40 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `userId` (text, NOT NULL), `name` (text, NOT NULL), `sku` (text, NULL), `category` (text, NOT NULL), `baseValueCents` (integer, NOT NULL, default 0), `defaultCommissionCents` (integer, NOT NULL, default 0), `active` (boolean, NOT NULL, default true), `sortOrder` (integer, NOT NULL, default 100), `deletedAt` (timestamp(3), NULL), `createdAt` (timestamp(3), NOT NULL), `updatedAt` (timestamp(3), NOT NULL), `version` (integer, NOT NULL, default 0).
- **Constraints:** `hccall_products_pkey` (PRIMARY KEY `id`).
- **Índices:** `hccall_products_tenantId_userId_idx`.

#### 5. `hccall_dynamizations` (8 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `userId` (text, NOT NULL), `name` (text, NOT NULL), `description` (text, NULL), `tierMode` (text, NOT NULL, default `'RETROACTIVE'`), `baseAmountPerSaleCents` (integer, NOT NULL, default 0), `startsAt` (timestamp(3), NOT NULL), `endsAt` (timestamp(3), NULL), `active` (boolean, NOT NULL, default true), `archived` (boolean, NOT NULL, default false), `deletedAt` (timestamp(3), NULL), `createdAt` (timestamp(3), NOT NULL), `updatedAt` (timestamp(3), NOT NULL), `version` (integer, NOT NULL, default 0).
- **Constraints:** `hccall_dynamizations_pkey` (PRIMARY KEY `id`).
- **Índices:** `hccall_dynamizations_tenantId_userId_idx`.

#### 6. `hccall_dynamization_tiers` (32 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `dynamizationId` (text, NOT NULL), `minQuantity` (integer, NOT NULL), `maxQuantity` (integer, NULL), `unitAmountCents` (integer, NOT NULL), `createdAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_dynamization_tiers_pkey` (PRIMARY KEY `id`), `hccall_dynamization_tiers_dynamizationId_fkey` (FOREIGN KEY `dynamizationId` REFERENCES `hccall_dynamizations(id)` ON DELETE CASCADE).
- **Índices:** `hccall_dynamization_tiers_tenantId_dynamizationId_idx`.

#### 7. `hccall_dynamization_bonuses` (24 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `dynamizationId` (text, NOT NULL), `thresholdCount` (integer, NOT NULL), `bonusAmountCents` (integer, NOT NULL), `createdAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_dynamization_bonuses_pkey` (PRIMARY KEY `id`), `hccall_dynamization_bonuses_dynamizationId_fkey` (FOREIGN KEY `dynamizationId` REFERENCES `hccall_dynamizations(id)` ON DELETE CASCADE).
- **Índices:** `hccall_dynamization_bonuses_tenantId_dynamizationId_idx`.

#### 8. `hccall_customers` (548 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `ownerUserId` (text, NOT NULL), `customerNumber` (text, NOT NULL), `name` (text, NULL), `phone` (text, NULL), `email` (text, NULL), `anonymizedAt` (timestamp(3), NULL), `createdAt` (timestamp(3), NOT NULL), `updatedAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_customers_pkey` (PRIMARY KEY `id`), `hccall_customers_tenantId_customerNumber_key` (UNIQUE `tenantId, customerNumber`).
- **Índices:** `hccall_customers_tenantId_customerNumber_idx`.

#### 9. `hccall_counters` (87 registos)
- **Colunas:** `tenantId` (text, NOT NULL), `prefix` (text, NOT NULL), `year` (integer, NOT NULL), `lastValue` (integer, NOT NULL, default 0), `updatedAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_counters_pkey` (PRIMARY KEY `tenantId, prefix, year`).

#### 10. `hccall_sale_statuses` (8 registos)
- **Colunas:** `id` (text, PK), `tenantId` (text, NOT NULL), `key` (text, NOT NULL), `label` (text, NOT NULL), `color` (text, NULL), `sortOrder` (integer, NOT NULL, default 100), `isTerminal` (boolean, NOT NULL, default false), `commissionState` (text, NOT NULL, default `'FORECAST'`), `isSystem` (boolean, NOT NULL, default false), `deletedAt` (timestamp(3), NULL), `createdAt` (timestamp(3), NOT NULL), `updatedAt` (timestamp(3), NOT NULL).
- **Constraints:** `hccall_sale_statuses_pkey` (PRIMARY KEY `id`), `hccall_sale_statuses_tenantId_key_key` (UNIQUE `tenantId, key`).

#### 11. `hccall_services` (4 registos) & `hccall_promotions` (5 registos)
Tabelas legadas v1 com `tenantId NOT NULL`, `name`, `color`, `suggestedCommissionCents`, `sortOrder`, `active`, `deletedAt`.

#### 12. `hccall_objectives` (0), `hccall_alerts` (0), `hccall_org_contexts` (0), `hccall_commissions` (0), `hccall_commission_lines` (0), `hccall_commission_adjustments` (0), `hccall_contacts` (0), `hccall_dynamization_rules` (0), `hccall_dynamization_conditions` (0).

---

## 1.3 MAPA DE ACESSO A DADOS & FLUXO DE PEDIDOS

```mermaid
flowchart TD
    Client[Cliente HTTP / Browser / Mobile PWA] -->|JWT no Header Authorization| FastifyHook[Fastify Route preHandler]
    FastifyHook -->|1. app.authenticate| JWTAuth[Valida JWT e extrai user.tenantId & user.sub]
    FastifyHook -->|2. app.requireApp('hccall')| Entitlements[Verifica Atribuição da App hccall ao Tenant]
    Entitlements --> Controller[HccallController Handler]
    Controller -->|Passa user.tenantId| TenantScopedClient[forTenant(user.tenantId)]
    TenantScopedClient -->|Prisma Client Extension| QueryRewriter[buildTenantScopedArgs: Injeta where: { tenantId } e data: { tenantId }]
    QueryRewriter --> ServiceLayer[HccallSaleService / HccallDynamizationService]
    ServiceLayer -->|Prisma Query / $transaction| PostgresDB[(PostgreSQL Database)]
```

### Camadas entre o Handler HTTP e a BD:
1. **Camada de Autenticação (`authenticate.ts`):** Extrai o token do cabeçalho `Authorization: Bearer <jwt>`, descodifica e injeta no `req.user` (`sub`, `tenantId`, `role`). **O `tenantId` nunca é lido do body, query ou URL pelo handler.**
2. **Camada de Permissões / Entitlements (`entitlements.ts`):** Verifica se a aplicação `hccall` está licenciada e ativa para o tenant do utilizador.
3. **Camada do Controlador (`HccallController.ts`):** Valida esquemas Zod e instancia o cliente Prisma com âmbito via `forTenant(user.tenantId)`.
4. **Camada de Extensão Prisma (`tenantScopedClient.ts`):** Interceta todas as operações Prisma (`findFirst`, `findMany`, `create`, `update`, `delete`, `upsert`, etc.) e injeta o `tenantId` nos argumentos `where` e `data`.
5. **Camada de Serviço (`HccallSaleService.ts`, etc.):** Executa a lógica de negócio encapsulada em transações (`db.$transaction`).
6. **PostgreSQL:** Executa as queries geradas pelo Prisma Client. **Nota Crítica:** Row-Level Security (RLS) está atualmente inativo (`rowsecurity: false`) em todas as tabelas.

---

## 1.4 MODELO DE AUTENTICAÇÃO E AUTORIZAÇÃO ATUAL

1. **Identificação do Utilizador:**
   - Realizada através de token JWT assinado com `JWT_SECRET`.
   - Payload do JWT contém: `{ sub: user.id, email: user.email, tenantId: user.tenantId, role: user.role }`.
2. **Identificação do Tenant:**
   - Exclusivamente derivada do campo `tenantId` presente no payload do JWT verificado no servidor.
   - Tentativas de passar `tenantId` como query param ou body param são ignoradas ou rejeitadas pelos esquemas Zod (os esquemas Zod do HCCALL não incluem `tenantId` nos schemas de entrada).
3. **Verificação de Permissões:**
   - Realizada em dois níveis:
     - **Nível de Aplicação:** `app.requireApp('hccall')` consulta a tabela `application_assignments` para confirmar que a aplicação `hccall` está associada ao `tenantId` e em estado ativo (`ACTIVE`).
     - **Nível de Âmbito de Dados (`HccallScopeService.ts`):** Se o utilizador tiver perfil de administrador (`ADMIN` ou `SUPER_ADMIN`), o escopo devolvido é vazio `{}` (vê todos os registos do tenant); se tiver perfil padrão (`USER`), o escopo devolvido é `{ ownerUserId: userId }` (vê apenas os seus próprios registos dentro do tenant).
     - **Tabelas RBAC:** As tabelas `roles`, `permissions`, `role_permissions` e `role_permission_links` já existem no banco de dados, mas contam atualmente com **0 registos**, sendo a autorização atual baseada na coluna `role` da tabela `users`.

---

## 1.5 ESTADO ATUAL DA AUDITORIA

### 1.5.1 Tabelas e Estrutura
- **Tabela Principal:** `audit_logs` (8.446 registos na BD).
  - Colunas: `id`, `seq` (bigserial global), `prevHash`, `hash`, `actorId`, `actorEmail`, `actorType`, `onBehalfOfId`, `impersonationId`, `sessionId`, `tenantId`, `module`, `category`, `action`, `resource`, `resourceId`, `description`, `oldValue` (jsonb), `newValue` (jsonb), `diff` (jsonb), `result`, `requestId`, `ipAddress`, `userAgent`, `timestamp`, `resealedAt`, `resealedBy`, `resealBatchId`.
- **Tabelas Auxiliares:**
  - `audit_chain_incidents` (18 registos documentados por corridas de escrita anteriores à v1.1.0).
  - `audit_chain_reseals` (24 lotes de re-selagem canónica documentados).

### 1.5.2 Formato do Hash e Encadeamento
- **Hash:** `SHA-256` calculado sobre o digest canónico:
  ```
  actorId|onBehalfOfId|tenantId|action|resource|resourceId|CanonicalJson(oldValue)|CanonicalJson(newValue)|timestamp(ISO)|prevHash
  ```
- **Serialização Canónica:** Executada através da classe `CanonicalJson` (ordenação determinística de chaves, formatação ISO-8601 UTC sem espaços espúrios).
- **Génese:** `GENESIS_PREV_HASH` está definido como 64 zeros (`"0".repeat(64)`).
- **Concorrência e Locks:** Utiliza `pg_advisory_xact_lock(hashtext(partitionKey))` por transação para serializar a leitura do último hash e escrita do novo.

### 1.5.3 O que NÃO é Registado Atualmente na Auditoria
- Leituras puras (operações `GET` de listagem e detalhe) não geram log de auditoria (apenas mutações `POST`, `PUT`, `DELETE`).
- No módulo HCCALL em particular:
  - `HccallProductService` e `HccallDynamizationService` não invocam explicitamente `AuditService.audit()` em todas as mutações CRUD (apenas gravam eventos de websocket SSE e persistência Prisma).
  - `HccallSaleService` grava histórico próprio em `hccall_sale_changes`, mas não emite evento estruturado para a tabela central `audit_logs` em todas as transições de estado.
  - Exportações CSV de vendas (`/api/hccall/export`) não emitem evento de auditoria `sales.exported`.

---

## 1.6 VOLUMETRIA ATUAL POR TABELA E POR TENANT

### 1.6.1 Volumetria Global por Tabela
| Tabela | Contagem de Linhas Reais na BD |
|---|---|
| `tenants` | 20 |
| `users` | 20 |
| `application_assignments` | 31 |
| `audit_logs` | 8.446 |
| `audit_chain_incidents` | 18 |
| `audit_chain_reseals` | 24 |
| `hccall_customers` | 548 |
| `hccall_counters` | 87 |
| `hccall_products` | 40 |
| `hccall_dynamization_tiers` | 32 |
| `hccall_dynamization_bonuses` | 24 |
| `hccall_dynamizations` | 8 |
| `hccall_sale_statuses` | 8 |
| `hccall_sales` | 5 |
| `hccall_sale_changes` | 5 |
| `hccall_promotions` | 5 |
| `hccall_services` | 4 |
| `hccall_sale_items` | 0 |
| `hccall_objectives` | 0 |
| `hccall_alerts` | 0 |
| `hccall_org_contexts` | 0 |
| `roles` / `permissions` / `role_permissions` | 0 |

### 1.6.2 Volumetria do HCCALL por Tenant
| Tenant ID | Nome do Tenant | Vendas (`hccall_sales`) | Clientes (`hccall_customers`) | Dinamizações | Produtos |
|---|---|---|---|---|---|
| `cmtqabwsw0006ta1y84r5vog4` | Consultoria Alfa, Lda. | 5 (todas ativas, 0 soft-deleted) | 548 | 8 | 40 |
| *Outros 19 tenants* | *Tenants de teste/plataforma* | 0 | 0 | 0 | 0 |

---

**Conclusão da Fase 1:** O módulo HCCALL possui uma arquitetura com separação clara de responsabilidades, componentes de UI responsivos e motor de comissões, mas apresenta lacunas estruturais que impedem a entrada segura em produção multi-tenant real (ausência de FKs de integridade referencial para tenants, RLS inativo na base de dados, e cobertura de auditoria incompleta em mutações).
