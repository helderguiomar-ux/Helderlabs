# HELDERLABS ERP — Auditoria Fase 2: Diagnóstico de Bugs e Inventário de Módulos

**Data:** 09/09/2026  
**Ambiente:** Fastify + Prisma + PostgreSQL + Vanilla JS (`backend/public`)  
**Fase:** 2 (Diagnóstico e Proposta de Consolidação — Leitura e Planeamento)

---

## 1. Diagnóstico Detalhado dos 8 Bugs (Confirmação & Causa Raiz)

| ID | Descrição Sumária | Ficheiro(s) e Linhas | Causa Raiz & Impacto | Veredito |
|---|---|---|---|---|
| **BUG-01** | **P2022 Schema Drift no Postgres** | `backend/src/services/AuthService.ts:21, 98`<br>`backend/prisma/schema.prisma:35-51` | No `schema.prisma`, o modelo `User` tem os campos `isOnline`, `lastSeen`, `sessionToken`, `avatar`, `status`, `roleId`. As migrações Prisma pendentes (`20260907233000_add_finance_module` e `20260908233000_add_hccall_sellmais`) contêm essas alterações, mas a base de dados PostgreSQL física de produção/desenvolvimento ainda não as recebeu (`column does not exist`). Quando `prisma.user.findUnique({ where: { email } })` é executado, a query tenta selecionar essas colunas inexistentes e lança erro `P2022`, impedindo totalmente o login. | **CONFIRMADO** |
| **BUG-02** | **Loop de Logout / 401 em `app.html`** | `backend/public/app.html:732-748` | A função `checkAuth()` faz um `fetch('/api/me/workspace')` sem incluir o cabeçalho `Authorization: Bearer <token>`. O backend Fastify recusa a rota protegida com status `401 Unauthorized`. O bloco `catch/status!=200` interpreta isso como ausência de sessão e executa `window.location.href = '/login.html'`, gerando um loop imediato após login. | **CONFIRMADO** |
| **BUG-03** | **Falta de JWT nos controladores JS de módulos** | `backend/public/js/finance.js:28-32, 316, 332, 373`<br>`backend/public/js/crm.js:23, 130, 376`<br>`backend/public/js/sellmais.js:30, 48, 60, 274, 317, 363, 384`<br>`backend/public/js/audit.js:25-27, 198` | Múltiplas funções assíncronas invocam a API REST através de `fetch()` nativo sem anexar cabeçalhos de autenticação (`Authorization: Bearer`). Todas as requisições AJAX dos módulos falham com 401, deixando os ecrãs em branco ou a emitir erros não tratados na consola. | **CONFIRMADO** |
| **BUG-04** | **Chave de sessão inconsistente no HCCALL** | `backend/public/hccall.html:736`<br>`backend/public/login.html:542-544` | O `login.html` armazena a sessão nas chaves `erp_session`, `hl_token` e `auth_token`. No entanto, o `hccall.html` tenta ler especificamente `localStorage.getItem('erp_token')`. Como esta chave está vazia (`null`), a validação de sessão em `hccall.html` falha imediatamente e redireciona o operador para o login. | **CONFIRMADO** |
| **BUG-05** | **Super Admin sem rotas para novos módulos** | `backend/public/super-admin.html:748-753, 912-960` | O método `openModuleAppByKey()` tem apenas casos de `switch` para `crm`, `condo` e `finance`. Ao tentar aceder a `hccall` ou `sellmais`, exibe um toast de 'módulo em construção'. Além disso, o modal de aprovação de tenants e formulários de licenciamento não disponibiliza checkboxes para licenciar `hccall` e `sellmais`. | **CONFIRMADO** |
| **BUG-06** | **Divergência de nomenclatura `finance` vs `financas`** | `backend/prisma/seed.ts:56`<br>`backend/src/routes/financas.routes.ts:9`<br>`backend/src/modules/finance/routes/index.ts:12`<br>`backend/public/js/modules.js:73`<br>`backend/public/app.html:49` | Incoerência de chaves: o `seed.ts` regista a app com a chave canónica `finance`. No entanto, as rotas Fastify verificam permissão com `app.requireApp('financas')` e o menu em `modules.js` / `app.html` usa a chave `financas`. Um tenant licenciado com `finance` fica sem permissão de aceder às rotas backend de finanças. | **CONFIRMADO** |
| **BUG-07** | **IDOR Crítico no HCCALL (`HccallSaleService`)** | `backend/src/modules/hccall/services/HccallSaleService.ts:114, 142, 168, 195` | Os métodos `getSaleById`, `updateSale`, `deleteSale` e `restoreSale` recebem o parâmetro `userId`, mas as queries Prisma executam `where: { id }` diretamente sem validar se a venda pertence ao utilizador quando este possui nível de permissão `OWN`. Qualquer utilizador autenticado consegue consultar, alterar ou apagar vendas de outros operadores se souber o UUID da venda. | **CONFIRMADO** |
| **BUG-08** | **Falta de Atomicidade Transacional (`$transaction`) no HCCALL** | `backend/src/modules/hccall/services/HccallSaleService.ts:32-85` | O método `createSale` executa até 7 operações independentes na base de dados (criação da venda, histórico de auditoria, registo de comissões, agendamento de chamada, etc.) fora de uma transação Prisma `$transaction`. Se ocorrer uma falha a meio (ex: erro de validação ou timeout), a venda é gravada mas os registos financeiros e de auditoria ficam corrompidos ou órfãos. | **CONFIRMADO** |

---

## 2. Inventário Rigoroso dos Módulos

### 2.1. Módulos VIVOS (Manter e Consolidar)

Estes módulos possuem tabelas ativas no Prisma, serviços de backend com lógica de negócio, rotas registadas e interfaces funcionais.

1. **`crm` (CRM & Gestão de Clientes)**
   - **Backend:** `src/routes/crm.routes.ts`, `src/services/CrmService.ts`
   - **Frontend:** `public/js/crm.js`, `public/app.html`
   - **Prisma:** Tabelas de contactos, leads e interações.
   - **Estado:** Ativo. Requer padronização de `apiFetch` para autenticação.

2. **`finance` (Gestão Financeira / Tesouraria / Contabilidade)**
   - **Backend:** `src/modules/finance/*`, `src/routes/financas.routes.ts`
   - **Frontend:** `public/js/finance.js`, `public/app.html`
   - **Prisma:** `FinanceAccount`, `FinanceTransaction`, `FinanceCategory`, `FinanceBudget`, etc. (via migração `20260907233000_add_finance_module`).
   - **Ação:** Unificar chave para `finance` em todo o ecossistema e registar alias `financas` no backend para retrocompatibilidade.

3. **`hccall` (Call Center / Vendas Telecom & Energia / Backoffice)**
   - **Backend:** `src/modules/hccall/*` (`HccallSaleService`, `HccallAuditService`, etc.)
   - **Frontend:** `public/hccall.html`, `public/js/hccall-*.js`
   - **Prisma:** `HccallSale`, `HccallAuditLog`, `HccallCommission`, etc. (via migração `20260908233000_add_hccall_sellmais`).
   - **Ação:** Corrigir IDOR (BUG-07), encapsular `createSale` em `$transaction` (BUG-08) e unificar tokens de sessão (BUG-04).

4. **`sellmais` (Gestão Comercial & Força de Vendas)**
   - **Backend:** `src/modules/sellmais/*`
   - **Frontend:** `public/sellmais.html`, `public/js/sellmais.js`
   - **Prisma:** `SellMaisContract`, `SellMaisCommission`, etc.
   - **Ação:** Padronizar chamadas HTTP com `apiFetch` e adicionar atalho no Super Admin (BUG-05).

---

### 2.2. Módulo INCOMPLETO / DORMENTE (Decisão: NÃO REMOVER)

* **`condominios` (Gestão de Condomínios e Fracções)**
  - **Evidências no Código:**
    - **7 Modelos no Prisma:** `CondoBuilding`, `CondoUnit`, `CondoOwner`, `CondoFee`, `CondoExpense`, `CondoPayment`, `CondoMeeting`.
    - **Serviço Backend:** `src/services/EnterpriseCondominiosService.ts` completo com regras de rateio e balancetes.
    - **Rotas:** `src/routes/condominios.routes.ts` com endpoints CRUD completos.
    - **Testes:** 7 testes unitários a passar em `backend/test/services/EnterpriseCondominiosService.test.ts`.
    - **Frontend:** Ecrã em desenvolvimento / mockup em `app.html`.
  - **Decisão e Recomendação:** **MANTER O MÓDULO**.
    - O relatório inicial sugeriu incorretamente que estava morto; contudo, a camada de dados e lógica de negócio está 100% testada e pronta.
    - Mantém-se no catálogo como módulo licenciável ou dormente no UI sem qualquer eliminação de ficheiros.

---

### 2.3. Módulos MORTOS (Proposta Exata de Remoção e Limpeza)

Estes módulos consistem apenas em strings soltas no `seed.ts` ou `modules.js`, sem tabelas no Prisma, sem serviços backend e sem rotas. Geram ruído visual e confusão no licenciamento.

| Chave | Onde existe atualmente | O que é | Risco de Remoção | Ação Proposta |
|---|---|---|---|---|
| **`invoicing`** | `prisma/seed.ts:51`<br>`src/scripts/prod-bootstrap.ts:48` | Referência a 'Faturação' legada sem modelos associados. | Zero (nenhum endpoint ou código depende desta chave). | Remover do `seed.ts` e `prod-bootstrap.ts`. |
| **`sales`** | `prisma/seed.ts:41`<br>`src/scripts/prod-bootstrap.ts:38` | Referência genérica a 'Vendas' (substituída por `crm` e `sellmais`). | Zero (sem rotas ou tabelas dedicadas). | Remover do `seed.ts` e `prod-bootstrap.ts`. |
| **`tasks`** | `prisma/seed.ts:46`<br>`src/scripts/prod-bootstrap.ts:43` | Referência a 'Tarefas' legada. | Zero. | Remover do `seed.ts` e `prod-bootstrap.ts`. |
| **`rent_a_car` / `rentacar`** | `public/js/modules.js:145-160` | Entrada de menu fantasma para 'Rent-a-car' sem backend. | Zero (frontend mostrava apenas erro). | Remover do array `SYSTEM_MODULES` em `modules.js`. |

---

## 3. Matriz de Ficheiros a Modificar na Fase 4 (Resumo)

1. **Base de Dados & Seed:**
   - `backend/prisma/seed.ts` (Remover `invoicing`, `sales`, `tasks`; padronizar `finance`).
   - `backend/src/scripts/prod-bootstrap.ts` (Sincronizar com `seed.ts`).
   - `deploy-build.mjs` (Substituir `prisma db push` ignorado por `npx prisma migrate deploy` com fail-fast).

2. **Segurança & Backend Services:**
   - `backend/src/modules/hccall/services/HccallSaleService.ts` (Corrigir IDOR com scoping por tenant/user e adicionar `$transaction`).
   - `backend/src/routes/financas.routes.ts` & `backend/src/modules/finance/routes/index.ts` (Compatibilizar `finance` e `financas`).
   - `backend/src/modules/tenant-licensing/*` (Nova infraestrutura de Ficha de Licenciamento com middleware de bloqueio estrito).

3. **Frontend & Autenticação Centralizada:**
   - `backend/public/js/api.js` (Garantir `apiFetch` universal com injeção automática de `Authorization: Bearer`).
   - `backend/public/app.html`, `finance.js`, `crm.js`, `sellmais.js`, `audit.js`, `hccall.html` (Migrar todas as chamadas `fetch` diretas para `apiFetch`).
   - `backend/public/super-admin.html` (Adicionar gestão de licenças completa por tenant e atalhos para `hccall` e `sellmais`).

---

## 4. Estado Atual e Próximos Passos

- [x] **Fase 1:** Mapeamento E2E e execução da suite de testes concluídos (`docs/AUDIT_MAPA.md`).
- [x] **Fase 2:** Diagnóstico aprofundado dos 8 bugs e inventário de módulos concluído (`docs/AUDIT_MODULOS.md`).
- [ ] **Fase 3:** Apresentação do Plano de Implementação detalhado.
- [ ] **Fase 4:** Execução do código e migrações.
- [ ] **Fase 5/6/8:** Validação E2E, testes e documentação final.

> **Ponto de Paragem Obrigatório:** Aguardando validação explícita do utilizador para avançar para a **Fase 3 (Plano de Implementação)**.