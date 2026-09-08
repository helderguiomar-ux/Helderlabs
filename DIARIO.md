# DIÁRIO DE TRABALHO — HELDERLABS ERP

> Registo cronológico de sessões, alterações de código, depurações e deploys.

---

## 2026-09-08 · [antigravity]

### 🎯 Objetivo
Resolver o bloqueio de login em produção, estabilizar a persistência de sessão e implementar o framework de governança `AGENTS.md`.

### 🔍 Ações Efetuadas
1. **Depuração do Loop de Login**:
   - Identificada discrepância entre `login.html` (que guardava `hl_token`) e os ecrãs corporativos (`workspace.html`, `super-admin.html`, `app.html`), que procuravam `erp_session`.
   - Atualizado `login.html` para guardar `erp_session` com `{ token, user }` no `localStorage` e redirecionar utilizadores `SUPER_ADMIN` e `PLATFORM_ADMIN` diretamente para `/super-admin.html`.
   - Atualizados os ecrãs de destino para resolver tokens por fallback (`erp_session` -> `hl_token` -> `auth_token`).

2. **Banner de Ligação & Preservação Offline**:
   - Desenvolvido `backend/public/assets/js/connection-banner.js`.
   - Integrado em `index.html`, `login.html`, `workspace.html`, `app.html` e `super-admin.html`.
   - Garante exibição do aviso top bar "Sem ligação ao servidor" e preservação automática de dados de formulário em `localStorage`.

3. **Verificação E2E em Produção**:
   - Executado teste Playwright em browser real contra `https://helderlabs.eu/login.html` com as credenciais de Super Administrador (`helderguiomar@gmail.com` / `admin1234`).
   - Confirmado acesso com sucesso e navegação sem redirecionamentos infinitos.

4. **Reestruturação do Login com Password**:
   - Atualizado `login.html` para incluir diretamente os campos de **Email** e **Palavra-passe** (com olho de visibilidade) na vista principal.
   - Ajustado o fluxo para submeter email + password diretamente com o botão "Entrar no ERP".
   - Atualizado o teste de browser Playwright (`test-e2e-browser.mjs`) para cobrir o fluxo direto com email e password.

5. **Estabilização do Módulo Financeiro**:
   - Corrigida a função `exportFinancas` em `app.html` para realizar o pedido HTTP autenticado com o cabeçalho `Authorization: Bearer <token>` e descarregar o ficheiro CSV via Blob.
   - Adicionado o pré-preenchimento automático da data atual nos campos de vencimento, início e empréstimo nos formulários de Finanças.
   - Garantida a limpeza integral de `localStorage` e `sessionStorage` em todos os handlers de `logout()`.

6. **Sistema de Rastreio & Governança**:
   - Criados e atualizados os ficheiros de governança de raiz: `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md`, `DIVIDA_TECNICA.md`.

7. **Correção Critical — Router app.html (Finanças abria CRM)**:
   - Identificado bug no `route()`: a ordem colocava `MODULES_REGISTRY` (em_construcao/planeado) antes do bloco `financas`, fazendo `#/financas` (status `beta`) cair no `else` e abrir o CRM.
   - Reordenado: `financas` e `condominios` verificados PRIMEIRO, antes do registry.
   - Removido código orphaned `loadCRM(); } }`.
   - Build local OK. Deploy `dpl_3wtMNn8iPbNJYGwwWfw61fWhPkzs` → `https://helderlabs.eu` · READY · 21:42 WEST.

8. **Correção Critical — modules.js compilado pelo Vercel para CJS**:
   - Vercel compilava `modules.js` (ESM: `export const`) para CJS durante deploy. Browser tentava importar como ES Module → importação falhava silenciosamente → `route()` nunca corria → `view-finance` ficava `display:none` → página em branco.
   - Convertido `modules.js` para globals `window.MODULES_REGISTRY` e `window.renderIncompleteModuleScreen`.
   - `app.html` e `index.html` actualizados para usar `<script src="...">` em vez de `import`.
   - Deploy `dpl_GTxeAGX2CKxw2gVJkuACiytVRDe6` · READY · 21:58 WEST.

9. **Correção Critical — IIFE órfão em app.html**:
   - Ao substituir `<script type="module">` por `<script>`, o `})();` do IIFE original ficou sem o `(function() {` correspondente → SyntaxError fatal → todo o JS parava → página em branco.
   - Removido `})();` órfão da linha 1238.
   - Deploy `dpl_4Ht1MyWGY9xvqbEodnk774gGvBzn` · READY · 22:09 WEST.

10. **Landing page — Botão "Entrar" e botões separados**:
    - Separados dois botões: `auth-area-btn` (com sessão → workspace) e `open-auth-modal` (sem sessão → login.html directo).
    - Modal actualizado: texto "Entrar com Email e Palavra-passe".
    - Login Enter key: corrigido para chamar `loginWithPassword()` directamente.
    - Logout: redireciona para `/` (landing) em vez de `/login.html`.

11. **Implementação do Módulo de Finanças Completo**:
    - **Base de Dados & Prisma**: Adicionados modelos `FinancialTransaction`, `FinancialAttachment`, `Budget`, `BudgetItem`, `CashFlowProjection`, `BankReconciliation`, `FinancialReport` com enums (`TransactionType`, `TransactionStatus`, `ExpenseCategory`, `BudgetStatus`).
    - **Multi-Tenant Security**: Modelos integrados na lista restrita `TENANT_SCOPED_MODELS` do `tenantScopedClient.ts`.
    - **Migração SQL Segura**: Criada migração `20260907233000_add_finance_module` compatível com PostgreSQL/Neon.
    - **Backend Services & Controllers (`/api/finance/*`)**:
      - `FinanceController` & `FinanceService`: CRUD completo de transações, filtros, status e aprovações.
      - `BudgetController` & `BudgetService`: Gestão de orçamentos e monitorização de limites com alerta automático >90%.
      - `CashFlowController` & `CashFlowService`: Projeções de fluxo de caixa multi-cenário (Base, Otimista, Pessimista).
      - `ReportsController` & `ReportService`: Demonstração de Resultados (P&L) estruturada e Balanço Patrimonial.
      - `DashboardController`: KPIs agregados, tendência mensal de 12 meses e distribuição de custos por categoria.
      - `BankReconciliationController`: Reconciliação bancária de extratos e conciliação de movimentos.
      - `ExportController`: Geração e download de ficheiro SAF-T (PT) oficial em formato XML e CSV de transações.
    - **Frontend & Visualização (`app.html`)**:
      - Nova sub-navegação em tabs no Módulo Financeiro (Dashboard, Transações, Orçamentos, Fluxo de Caixa, Relatórios P&L, Reconciliação Bancária, Categorias).
      - Gráficos responsivos SVG em tempo real (evolução mensal receitas vs despesas e percentagens por categoria).
      - Tabela preditiva de fluxo de caixa com filtros de horizonte temporal e cenário.
      - Gerador interativo de relatórios P&L com exportação/impressão.
      - Barras de progresso e alertas visuais de teto orçamental.

12. **Implementação Completa dos Módulos HCCALL Telecom e 2SELLMAIS (Fases 0 a 14 · v0.5.0)**:
    - **Fase 0 a 5 (HCCALL Telecom `hccall`)**:
      - PWA standalone mobile-first (`hccall.html`, `hccall-sw.js`, `hccall.webmanifest`) com operação com uma mão e tempos de registo <20s.
      - Fila offline local com IndexedDB e endpoint `POST /api/hccall/sync` idempotente com `clientUuid`.
      - Snapshot imutável de promoções (`promotionSnapshot`) e histórico auditado de alterações (`HccallSaleChange`).
      - Relatórios de comissões por estado (`FORECAST`, `CONFIRMED`, `PAID`) e exportação CSV estruturada (BOM UTF-8 e `;`).
      - Registo e histórico de interações com clientes (`HccallContact`).
    - **Fase 6 a 12 (2SELLMAIS `sellmais`)**:
      - Registo de artigos com validação dinâmica de atributos JSONB por tipo via Zod e código sequencial `ART-YYYY-NNNN`.
      - Máquina de estados estrita (`DRAFT` ➔ `AVAILABLE` ➔ `RESERVED` ➔ `SOLD`) com bloqueio de transições inválidas (HTTP 409).
      - Materialização de custos em tempo real (`totalCostCents` = aquisição + restauros + taxas) e margem real calculada no backend.
      - Proveniência (`SellProvenance`), Restauros (`SellRestoration`) e Gestão Multimédia (`SellItemMedia`).
      - Gestão de contratos de consignação (`SellConsignment`), comitentes e liquidações com separação no valor de inventário.
      - Catálogo público SSR (`/loja`, `/loja/artigo/:slug`) com JSON-LD Schema `Product`, Open Graph e whitelist estrita de proteção de custos confidenciais.
      - Assistente IA de descrições e peritagem (`SellAiService`) em conformidade com o código deontológico de antiguidades.
      - Outbox assíncrono para publicação e despublicação em canais (`SellChannelJob`) e suporte ao modo manual honesto (`manualOnly`).
      - Motor de leilões concorrente (`SellAuction`, `SellAuctionLot`, `SellBid`) com validação atómica de incrementos e proteção anti-sniping.
    - **Fases 13 e 14 (Painéis, Alertas & QA Total)**:
      - Relatórios de envelhecimento de inventário (`/api/sellmais/reports/aging`), alertas de prazos de consignação e peças sem preço/foto.
      - 86 testes unitários e E2E aprovados (100% green em 20 suites).
      - 24 asserções full-stack no script de auditoria E2E.
      - Typecheck e build limpos com zero erros.
