# HELDERLABS ERP — MAPA DO SISTEMA & AUDITORIA E2E (FASE 1)

> **Documento de Entrega da Fase 1**  
> **Data:** 2026-09-09 · **Versão:** v0.5.0 · **Ambiente:** Local / Vercel (`helderlabs.eu`)  
> **Responsável:** Antigravity (Engenheiro de Estabilização)

---

## 1. Estrutura de Pastas, Stack & Scripts

### 1.1 Estrutura de Pastas
```
helderlabs-erp/
├── .github/                      # Workflows CI/CD
├── .vercel/                      # Configurações Vercel CLI
├── api/
│   └── index.ts                  # Serverless entrypoint Fastify para Vercel
├── backend/
│   ├── dist/                     # Build compilado TypeScript
│   ├── prisma/
│   │   ├── migrations/           # 5 migrações registadas
│   │   ├── schema.prisma         # Schema central (1913 linhas)
│   │   └── seed.ts               # Seed de desenvolvimento multi-tenant
│   ├── public/                   # Frontend estático vanilla HTML/CSS/JS
│   │   ├── assets/
│   │   │   ├── css/              # Design System tokens, typography, app.css
│   │   │   └── js/               # Controladores modulares (finance, crm, audit, sellmais, modules)
│   │   ├── app.html              # Cockpit Unificado (Finanças, CRM, Auditoria, SellMais, Condomínios)
│   │   ├── hccall.html           # PWA Mobile-First HCCALL Telecom
│   │   ├── index.html            # Landing page institucional
│   │   ├── login.html            # Ecrã corporativo de autenticação (Email + Password / OTP)
│   │   ├── super-admin.html      # Consola de Gestão de Plataforma, Tenants e Módulos
│   │   └── workspace.html        # Launcher de aplicações por tenant
│   ├── scripts/
│   │   ├── collect-and-run-tests.mjs # Runner nativo node:test
│   │   ├── deploy-build.mjs      # Script de build de produção (Vercel)
│   │   ├── prod-bootstrap.ts     # Sincronização idempotente de módulos em produção
│   │   └── run-e2e-audit.mjs     # Runner de auditoria E2E
│   ├── src/
│   │   ├── database/prisma/      # Singleton e health check do Prisma Client
│   │   ├── modules/              # Módulos verticais: auth, crm, condominios, financas, finance, hccall, platform, sellmais
│   │   ├── plugins/              # Plugins Fastify: authenticate, entitlements
│   │   ├── routes/               # Rotas públicas (/api/public/register, /api/public/leads)
│   │   ├── app.ts                # Inicializador Fastify, Cors, Helmet, ErrorHandler, Rotas
│   │   └── server.ts             # Servidor HTTP local (Porta 3333)
│   ├── tests/                    # 22 ficheiros de teste (Auth, CRM, Condomínios, Finanças, HCCALL, SellMais, Plataforma)
│   ├── package.json              # Dependências e scripts do backend
│   └── tsconfig.json             # Configuração do TypeScript
├── docs/                         # Documentação técnica e planos de arquitetura
├── qa/                           # Auditorias anteriores e contratos de qualidade
├── vercel.json                   # Configuração de build, rewrites e security headers
└── docker-compose.yml            # PostgreSQL local 5432
```

### 1.2 Stack Tecnológica
- **Backend:** Node.js (>=20 <25), Fastify 4.28, TypeScript 5.5, TSX 4.16.
- **ORM / Base de Dados:** Prisma 5.20, PostgreSQL 16 (local em `localhost:5432` / remoto em produção).
- **Segurança & Criptografia:** JWT (`jsonwebtoken`, `jose`), Bcrypt 5.1, SHA-256 Chained Auditing, Rate-Limiting (`@fastify/rate-limit`), Helmet (`@fastify/helmet`), CORS (`@fastify/cors`).
- **Comunicação em Tempo Real:** Socket.IO / `@fastify/socket.io`.
- **Frontend:** HTML5 semântico, CSS com Design System Tokens customizados, Vanilla JavaScript modular, PWA Service Worker (HCCALL).
- **Testes:** Runner nativo `node:test` + `tsx`, Playwright 1.63.

### 1.3 Scripts de Build e Deploy
- **Deploy no Vercel:** `"cd backend && npm install && node scripts/deploy-build.mjs"`
- **Geração de Tipos e Build:** `prisma generate && tsc -p tsconfig.json`
- **Testes:** `node scripts/collect-and-run-tests.mjs` (86 testes / 20 suites).

---

## 2. Prisma Schema, Modelos & Estado Real das Migrações

### 2.1 Modelos e Enums
O `schema.prisma` contém **45 modelos** e **18 enums** cobrindo:
1. **Núcleo Multi-Tenant & Plataforma:** `Tenant`, `User`, `Role`, `RolePermissionLink`, `Module`, `Permission`, `RolePermission`, `PlatformSetting`, `TenantSetting`, `TenantBranding`, `ImpersonationSession`, `AuditLog`, `AccountRequest`, `UserActivity`, `ApplicationInstance`, `ApplicationAssignment`.
2. **CRM Empresa 360º:** `Company`, `CompanyContact`, `CompanyAddress`, `CompanyDocument`, `Contract`, `CompanyRelation`, `Lead`, `Opportunity`, `Customer`, `Contact`, `Communication`.
3. **Gestão de Condomínios:** `Building`, `Unit`, `Owner`, `Fee`, `Assembly`, `Vote`, `Expense`.
4. **Finanças & Tesouraria (Dual):**
   - *Schema Legado / Pessoal:* `FinanceAccount`, `CostCenter`, `FinanceCategory`, `FinanceTransaction`, `RecurringRule`, `Loan`, `LoanPayment`, `Budget` (finance_budgets).
   - *Schema Corporativo Pro:* `FinancialTransaction`, `FinancialAttachment`, `Budget`, `BudgetItem`, `CashFlowProjection`, `BankReconciliation`, `FinancialReport`.
5. **HCCALL Telecom:** `HccallService`, `HccallPromotion`, `HccallStatus`, `HccallSale`, `HccallSaleHistory`, `HccallCustomer`, `HccallCustomerContact`.
6. **2SELLMAIS (Antiguidades / Leilões):** `SellItemType`, `SellLocation`, `SellItem`, `SellItemCost`, `SellConsignment`, `SellConsignmentItem`, `SellChannel`, `SellChannelListing`, `SellOutboxJob`, `SellAuction`, `SellAuctionLot`, `SellAuctionBid`, `SellItemProvenance`, `SellItemRestoration`, `SellItemMedia`.

### 2.2 Estado Real das Migrações (`npx prisma migrate status`)
Executado contra a base de dados PostgreSQL (`localhost:5432/helderlabs_erp`):
```
5 migrations found in prisma/migrations
Following migrations have not yet been applied:
  20260907233000_add_finance_module
  20260908233000_add_hccall_sellmais
```
* **Migrações aplicadas no banco:** `0000_baseline`, `20260823202500_initial_schema`, `20260906214800_full_schema_update`.
* **Drift Crítico de Schema:** As colunas `isOnline`, `lastSeen`, `sessionToken`, `avatar`, `status`, `roleId` no modelo `users` estão definidas no Prisma Schema, mas **não foram migradas** para a tabela física `users` da base de dados.
* **Causa do Erro P2022:** `prisma.user.findUnique({ where: { email } })` tenta selecionar essas colunas que não existem no PostgreSQL.

---

## 3. Catálogo de Rotas do Backend & PreHandlers

| Prefixo | Ficheiro de Rotas | PreHandlers / Guards | Endpoints Registados |
| :--- | :--- | :--- | :--- |
| `/api/auth` | `auth.routes.ts` | Rate-limit (5/15m prod); `/set-password`, `/me`, `/me/workspace` usam `app.authenticate` | `POST /check-email`, `POST /send-otp`, `POST /verify-otp`, `POST /login`, `POST /set-password`, `GET /me`, `GET /me/workspace`, `GET /google`, `GET /microsoft`, `GET /apple` |
| `/api/public` | `public.routes.ts` | Rate-limit (5/15m) | `POST /register`, `POST /leads` |
| `/api/platform` | `platform.routes.ts` | `app.authenticate` + Role Check (`SUPER_ADMIN` \| `PLATFORM_ADMIN`) | `GET /tenants`, `POST /tenants`, `PATCH /tenants/:id/status`, `GET /users`, `PATCH /users/:id/status`, `GET /account-requests`, `GET /roles`, `POST /impersonate`, `POST /impersonate/end`, `POST /account-requests/:id/approve`, `POST /account-requests/:id/reject`, `GET /licensing/summary`, `GET /audit-chain/verify`, `GET /audit/logs`, `GET /audit/dashboard`, `GET /audit/resource/:resource/:resourceId` |
| `/api/platform/applications` | `applications.routes.ts` | `app.authenticate` + (`SUPER_ADMIN` \| `PLATFORM_ADMIN` \| `TENANT_ADMIN`) | `GET /modules`, `GET /`, `POST /`, `PATCH /:applicationId`, `DELETE /:applicationId`, `POST /:applicationId/assign`, `DELETE /:applicationId/assign/:userId` |
| `/api/crm` | `crm.routes.ts` | `app.authenticate` + `app.requireApp('crm')` | `GET/POST /companies`, `GET/PUT/DELETE /companies/:id`, `POST /companies/:id/restore`, `POST /companies/:id/contacts`, `PUT/DELETE /contacts/:id`, `POST /companies/:id/addresses`, `DELETE /addresses/:id`, `POST /companies/:id/documents`, `DELETE /documents/:id`, `GET /contracts`, `POST /companies/:id/contracts`, `PUT/DELETE /contracts/:id`, `POST /companies/:id/relations`, `DELETE /relations/:id`, `GET/POST /leads`, `PUT/DELETE /leads/:id`, `POST /leads/:id/convert`, `GET /opportunities`, `POST /opportunities/:id/win`, `GET /customers`, `GET /dashboard` |
| `/api/condominios` | `condominios.routes.ts` | `app.authenticate` + `app.requireApp('condominios')` | `GET/POST /buildings`, `PUT/DELETE /buildings/:buildingId`, `GET/POST /buildings/:buildingId/units`, `DELETE /buildings/:buildingId/units/:unitId` |
| `/api/financas` | `financas.routes.ts` | `app.authenticate` + `app.requireApp('financas')` | `GET/POST /accounts`, `PUT/DELETE /accounts/:id`, `POST /accounts/:id/restore`, `GET/POST /cost-centers`, `PUT/DELETE /cost-centers/:id`, `GET/POST /categories`, `PUT/DELETE /categories/:id`, `POST /categories/:id/restore`, `GET /categories/budget-status`, `GET/POST /transactions`, `PUT/DELETE /transactions/:id`, `PATCH /transactions/:id/pay`, `PATCH /transactions/:id/approve`, `POST /transactions/:id/restore`, `GET/POST /transactions/:id/attachments`, `DELETE /attachments/:id`, `GET/POST /recurring`, `DELETE /recurring/:id`, `POST /recurring/materialize`, `GET/POST /loans`, `DELETE /loans/:id`, `POST /loans/:id/payments`, `GET /dashboard`, `GET /kpis`, `GET /projections`, `GET /burn-rate`, `GET /export`, `DELETE /gdpr/anonymize` |
| `/api/finance` | `finance/routes/index.ts` | `app.authenticate` + `app.requireApp('financas')` | Sub-rotas corporativas em `/transactions`, `/budgets`, `/dashboard`, `/reports`, `/reconciliation`, `/cashflow`, `/export` |
| `/api/hccall` | `hccall.routes.ts` | `app.authenticate` + `app.requireApp('hccall')` | `GET/POST /services`, `PUT/DELETE /services/:id`, `GET/POST /promotions`, `PUT/DELETE /promotions/:id`, `GET/POST /statuses`, `PUT/DELETE /statuses/:id`, `GET/POST /sales`, `GET/PUT/DELETE /sales/:id`, `POST /sales/:id/restore`, `GET /customers`, `GET /customers/:id`, `POST /customers/:id/contacts`, `DELETE /customers/:id/anonymize`, `GET /dashboard`, `GET /reports/commissions`, `GET /export`, `GET /reports/export.csv`, `POST /sync`, `POST /ai/query` |
| `/api/sellmais` | `sellmais.routes.ts` | `app.authenticate` + `app.requireApp('sellmais')` | `GET/POST /types`, `PUT/DELETE /types/:id`, `GET/POST /locations`, `DELETE /locations/:id`, `GET/POST /items`, `GET/PUT/DELETE /items/:id`, `POST /items/:id/restore`, `POST /items/:id/transition`, `GET/POST /items/:id/costs`, `DELETE /costs/:id`, `GET/POST /consignments`, `POST /consignments/:id/items`, `POST /consignments/:id/items/:itemId/settle`, `GET/POST /channels`, `GET /channels/listings`, `POST /channels/jobs/process`, `GET/POST /auctions`, `POST /auctions/:id/lots`, `POST /auctions/:id/lots/:lotId/bid`, `POST /items/:id/provenance`, `POST /items/:id/restorations`, `POST /items/:id/media`, `DELETE /media/:id`, `POST /ai/describe`, `GET /valuation`, `GET /reports/aging`, `GET /reports/alerts`, `GET /reports/profitability` |
| `/loja` | `app.ts` (SSR) | Rota Pública (SSR com SEO & Schema.org) | `GET /loja` (Storefront), `GET /loja/artigo/:slug` (Ficha pública de artigo) |
| `/api/health` | `app.ts` | Rota Pública | `GET /api/health`, `GET /health` |

---

## 4. Ecrãs de Frontend & Controladores JavaScript

1. **`login.html` (Autenticação Unificada):**
   - Ecrã inicial que aceita Email e Password com alternância para OTP (6 dígitos).
   - Suporta formulário modal de pedido público de adesão ("Solicitar Acesso ao ERP").
   - Guarda a sessão sob 3 chaves: `erp_session`, `hl_token` e `auth_token`.
2. **`workspace.html` (Launcher de Aplicações do Tenant):**
   - Faz `fetch('/api/me/workspace')` com `Authorization: Bearer <token>`.
   - Apresenta os cartões de aplicações ativas e secção de upsell ("Disponível com Upgrade").
   - Permite pesquisa rápida (<kbd>Ctrl+K</kbd>), modal de definições da empresa e alteração de password.
3. **`super-admin.html` (Consola de Administração da Plataforma):**
   - Monitorização de empresas, aprovação atómica de contas, licenciamento por tenant, utilizadores online e logs de auditoria SHA-256.
4. **`app.html` (Cockpit Modular Unificado):**
   - Shell com navegação por tabs: Finanças (`#financas`), CRM 360º (`#crm`), Auditoria (`#audit`), 2SELLMAIS (`#sellmais`), HCCALL (`#hccall`), Condomínios (`#condominios`).
   - Carrega controladores dedicados: `finance.js`, `crm.js`, `audit.js`, `sellmais.js`, `modules.js`.
5. **`hccall.html` (PWA Mobile-First HCCALL Telecom):**
   - Aplicação autónoma com Service Worker (`hccall-sw.js`), suporte Offline-First via IndexedDB (`hccall_local_db`), registo de vendas <20s, cálculo de comissões e sincronização idempotente.

---

## 5. Inventário de Chaves de Módulo

| Chave Encontrada | Onde Aparece no Código | Estado Atual | Destino Recomendado na Consolidação |
| :--- | :--- | :--- | :--- |
| **`crm`** | `schema.prisma`, `seed.ts`, `prod-bootstrap.ts`, `crm.routes.ts`, `modules.js`, `app.html`, `workspace.html`, `super-admin.html` | **VIVO** | Manter canónica: `crm` |
| **`finance`** | `schema.prisma`, `seed.ts`, `prod-bootstrap.ts`, `finance/routes/index.ts`, `EntitlementService.ts`, `workspace.html` | **VIVO** | **Definir como Canónica Única: `finance`** |
| **`financas`** | `financas.routes.ts`, `modules.js`, `app.html`, `finance.js`, `super-admin.html` | **VIVO (Divergência)** | Alias no frontend `/app.html#financas`, chave interna convertida para `finance` |
| **`hccall`** | `schema.prisma`, `seed.ts`, `prod-bootstrap.ts`, `hccall.routes.ts`, `modules.js`, `app.html`, `workspace.html`, `hccall.html` | **VIVO** | Manter canónica: `hccall` |
| **`sellmais`** | `schema.prisma`, `seed.ts`, `prod-bootstrap.ts`, `sellmais.routes.ts`, `modules.js`, `app.html`, `workspace.html` | **VIVO** | Manter canónica: `sellmais` |
| **`audit`** | `modules.js`, `app.html`, `audit.js` | **VIVO (Feature transversal)** | Funcionalidade da plataforma (não é licença isolada por tenant) |
| **`condominios`** | `schema.prisma`, `seed.ts`, `prod-bootstrap.ts`, `condominios.routes.ts`, `modules.js`, `app.html`, `workspace.html`, `super-admin.html` | **INCOMPLETO / DORMENTE** | Tem modelos e backend CRUD, frontend em construção |
| **`invoicing`** | `seed.ts`, `prod-bootstrap.ts` (`isActive: false`) | **MORTO** | Remover do seed/bootstrap |
| **`sales`** | `seed.ts`, `prod-bootstrap.ts` (`isActive: false`) | **MORTO** | Remover do seed/bootstrap |
| **`tasks`** | `seed.ts`, `prod-bootstrap.ts` (`isActive: false`) | **MORTO** | Remover do seed/bootstrap |
| **`rent_a_car` / `rentacar`** | `modules.js` (apenas descrição UI), `schema.prisma` (comentário) | **MORTO** | Remover de `modules.js` |

---

## 6. Inventário de Chaves de Sessão & Storage

| Ficheiro | Chaves Escritas | Chaves Lidas | Problema Identificado |
| :--- | :--- | :--- | :--- |
| `login.html` | `erp_session`, `hl_token`, `auth_token` | — | Grava 3 chaves diferentes para a mesma sessão. |
| `workspace.html` | `erp_session` | `erp_session`, `hl_token`, `auth_token` | Lê com fallbacks múltiplos. |
| `super-admin.html` | `erp_session` (no impersonate) | `erp_session`, `hl_token`, `auth_token` | Lê com fallbacks múltiplos. |
| `index.html` | — | `hl_token`, `erp_session`, `hl_lang`, `hl_theme` | Lê com fallbacks. |
| `hccall.html` | — | `erp_token` (localStorage / sessionStorage / Cookie) | **BUG-04:** Chave `erp_token` não existe no storage, causando redirect permanente. |
| `app.html` | — | **Nenhuma** | **BUG-02:** `checkAuth()` não lê nenhuma chave e chama a API desprotegida. |
| `finance.js`, `crm.js`, `sellmais.js`, `audit.js` | — | **Nenhuma** | **BUG-03:** Todos os ficheiros fazem `fetch()` sem nenhum token. |

---

## 7. Inventário de Testes Existentes & Cobertura

Executado `npm test` (`node scripts/collect-and-run-tests.mjs`):
- **Total de Suites:** 20 suites
- **Total de Testes:** 86 testes
- **Resultado:** 86 passaram / 0 falharam (100% verde nos testes unitários com mocks)
- **Ficheiros de Teste:**
  1. `tests/auth/AuthService.test.ts` (Login Super Admin, Password default, Alteração de password)
  2. `tests/auth/security.test.ts` (Hash de passwords, Brute-force rate limits)
  3. `tests/auth/oauth/oauthState.test.ts` & `pkce.test.ts` (Criptografia OAuth/PKCE)
  4. `tests/condominios/EnterpriseCondominiosService.test.ts` (CRUD Buildings/Units com FakePrisma)
  5. `tests/crm/Company360.test.ts` & `EnterpriseCRMService.test.ts` (Ficha 360, NIF, Relações)
  6. `tests/database/tenantScopedClient.test.ts` (Isolamento multi-tenant)
  7. `tests/financas/FinanceCalcService.test.ts` & `RecurrenceService.test.ts` (Cálculo de saldos em cêntimos)
  8. `tests/hccall/hccall.test.ts` (Registo de vendas, comissões, snapshot de campanhas)
  9. `tests/platform/approvals.test.ts`, `auditChain.test.ts`, `entitlements.test.ts`, `guards.test.ts`, `impersonation.test.ts`
  10. `tests/public/publicRoutes.test.ts` & `translationParity.test.ts`
  11. `tests/security/tenantIsolationGuard.test.ts`
  12. `tests/sellmais/sellmais.test.ts` (Máquina de estados, Leilões, Custo materializado, Catálogo SSR)

---

## 8. Discrepâncias entre o Relatório Inicial e o Código Real

| Ponto no Relatório Inicial | Realidade Encontrada no Código | Impacto / Correção |
| :--- | :--- | :--- |
| **Recomendação de usar `prisma db push`** | `prisma db push` é perigoso em ambientes com dados existentes pois pode descartar tabelas/colunas em caso de conflito. | **Correção:** Deve usar-se estritamente `npx prisma migrate deploy` e criar migrações SQL aditivas controladas. |
| **Tratamento de erro no deploy (`deploy-build.mjs`)** | O script engolia erros de sincronização com `try/catch` emitindo apenas `console.warn`. | **Correção:** O build tem de propagar a falha e abortar com código de saída != 0 para nunca colocar em produção código com DB desfasada. |
| **Classificação de severidade do IDOR (HL-C02 / BUG-07)** | O relatório inicial colocou o IDOR no final da lista. | **Correção:** O IDOR é de severidade **CRÍTICA** (permite a um operador apagar/alterar vendas de colegas) e deve ser resolvido imediatamente no Bloco A. |
| **Divergência de Nomenclatura (`finance` vs `financas`)** | O relatório classificou como MÉDIA. | **Correção:** Como as permissões e o licenciamento dependem da chave do módulo, esta divergência é de severidade **ALTA** e tem de ser unificada na chave canónica `finance`. |
| **Módulo Condomínios** | Apontado genericamente como em construção. | **Realidade:** O módulo tem schema de 7 tabelas, service completo e 7 testes unitários. Não está morto, está dormente a nível de UI. |

---

> 🛑 **Fase 1 Concluída.** O mapa do sistema e o ficheiro `docs/AUDIT_MAPA.md` foram gerados sem efetuar qualquer alteração no código-fonte. Aguardo a tua validação para avançar para a **Fase 2 (Diagnóstico e Inventário de Módulos)**.
