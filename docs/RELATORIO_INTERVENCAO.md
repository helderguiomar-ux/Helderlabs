# HELDERLABS ERP — Relatório Final de Intervenção e Estabilização E2E

**Data:** 09/09/2026  
**Ambiente:** Fastify + Prisma + PostgreSQL + Vanilla JS (`backend/public`)  
**Status:** Concluído com Sucesso — 92/92 Testes Passados (100%)

---

## 1. Sumário Executivo

A intervenção técnica no **HELDERLABS ERP** eliminou todas as vulnerabilidades de segurança identificadas, repôs a autenticação e o acesso unificado a todos os módulos, consolidou o catálogo de aplicações e implementou a gestão de licenciamento por tenant.

---

## 2. Resolução Integral dos 8 Bugs Auditados

| ID | Descrição & Causa Raiz | Ficheiro(s) Afetado(s) | Resolução Aplicada |
|---|---|---|---|
| **BUG-01** | **P2022 Schema Drift no Postgres** (Colunas `isOnline`, `lastSeen`, etc. em falta na BD física) | `backend/prisma/schema.prisma`<br>`backend/scripts/deploy-build.mjs` | Aplicadas as migrações `20260907233000_add_finance_module` e `20260908233000_add_hccall_sellmais` via `npx prisma migrate deploy`. Substituído o `prisma db push` mascarado no build por verificação estrita. |
| **BUG-02** | **Loop de Logout em `app.html`** (`checkAuth` chamava `/api/me/workspace` sem JWT) | `backend/public/app.html` | Implementada integração universal com `apiFetch('/api/me/workspace')` injetando automaticamente o header `Authorization: Bearer <token>`. |
| **BUG-03** | **Falta de JWT nos controladores JS de módulos** | `backend/public/assets/js/finance.js`<br>`backend/public/assets/js/crm.js`<br>`backend/public/assets/js/sellmais.js`<br>`backend/public/assets/js/audit.js` | Criado o utilitário `backend/public/assets/js/api.js` e refatoradas todas as chamadas nativas de `fetch` para `apiFetch`. |
| **BUG-04** | **Chave de sessão inconsistente no HCCALL** (`hccall.html` procurava apenas `erp_token`) | `backend/public/hccall.html`<br>`backend/public/login.html` | Unificada a leitura de tokens com suporte a `erp_session`, `hl_token`, `auth_token` e `erp_token` em cascata. |
| **BUG-05** | **Super Admin sem rotas para novos módulos** | `backend/public/super-admin.html` | Atualizado o método `openModuleAppByKey` para suportar `hccall` (`/hccall.html`) e `sellmais` (`/app.html#/sellmais`), e adicionadas opções de licenciamento no modal de aprovação. |
| **BUG-06** | **Divergência de nomenclatura `finance` vs `financas`** | `backend/src/config/modules.ts`<br>`backend/src/plugins/entitlements.ts`<br>`backend/public/assets/js/modules.js` | Estabelecida a chave canónica `finance` com mapeamento transparente e retrocompatível do alias `financas` no backend e frontend. |
| **BUG-07** | **IDOR Crítico no HCCALL** (`HccallSaleService` sem filtro de utilizador em âmbito `OWN`) | `backend/src/modules/hccall/services/HccallSaleService.ts`<br>`backend/src/modules/hccall/controllers/HccallController.ts` | Adicionada validação de escopo (`HccallScopeService`) em `getSaleById`, `updateSale`, `deleteSale` e `restoreSale`, bloqueando manipulação não autorizada. |
| **BUG-08** | **Falta de Atomicidade Transacional no HCCALL** (`createSale` fora de transação) | `backend/src/modules/hccall/services/HccallSaleService.ts` | Encapsuladas todas as 7 operações de criação de venda, auditoria, dinamizações e comissões dentro de `db.$transaction`. |

---

## 3. Catálogo Canónico de Módulos

O catálogo foi consolidado e centralizado em `backend/src/config/modules.ts`:

1. **`crm`**: CRM & Gestão Comercial 360º (`VIVO`)
2. **`finance`** (alias: `financas`): Gestão Financeira, Tesouraria e Projeções (`VIVO`)
3. **`hccall`**: Call Center Telecom & Energia com motor Offline PWA (`VIVO`)
4. **`sellmais`**: Inventário, Leilões e Comércio 2SELLMAIS (`VIVO`)
5. **`condominios`** (alias: `condo`): Gestão de Condomínios (`DORMENTE — Preservado`)

### Módulos Mortos Removidos:
- `invoicing`, `sales`, `tasks` (Removidos de `seed.ts` e `prod-bootstrap.ts`).
- `rent_a_car` (Removido de `modules.js`).

---

## 4. Ficha de Licenciamento & Segurança

- **Middleware Estrito (`requireApp`):** Qualquer rota de módulo valida se o tenant possui a aplicação no estado `ACTIVE`, `TRIAL` ou `GRACE`. Caso contrário, devolve imediatamente HTTP `403 Forbidden`.
- **Super Admin (`super-admin.html`):** Permite aprovação de contas com seleção individual de módulos (CRM, Condomínios, Finanças, HCCALL, SellMais) e gestão de estados por tenant.

---

## 5. Validação e Testes

- **Compilação TypeScript:** `npx tsc --noEmit` concluído com **0 erros**.
- **Testes Automatizados:** `npm test` executou 23 suites com **92 testes passados a 100%** (incluindo a nova suite `hccall-idor-entitlements.test.ts`).
