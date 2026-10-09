# Relatório Antigravity — CRM HelderLabs Fase B7 (v1.6.7)

**Data:** 2026-10-09  
**Módulo:** HelderLabs CRM — Fase B7 (Conta Corrente de Clientes, Extrato Progressivo, Alocação de Pagamentos e Análise de Antiguidade)  
**Destino de Produção:** `https://helderlabs.eu` (Vercel `helderlabs-erp`, Deployment ID: `dpl_7mXoTMZNmVgGJCq32V4vqPJGUbSW`)  
**Commit de Código:** `df8e3a2`  
**Commit de Governação:** `23cb56f`  

---

## 1. Resumo Executivo da Entrega

A **Fase B7** do HelderLabs CRM foi concluída e publicada com sucesso em produção (`https://helderlabs.eu`), dotando o ERP corporativo de um motor completo de **Conta Corrente de Clientes**:
- Registo contabilístico de documentos emitidos no software de faturação certificado e respetivos pagamentos recebidos.
- **Salvaguarda legal e regulamentar inviolável**: *«Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal.»*
- **Imutabilidade estrita** garantida por triggers PostgreSQL a nível de base de dados: `DELETE` proibido; atualizações restritas; enganos corrigidos exclusivamente via contrapartida de estorno (`REVERSAL`).
- Precisão monetária em cêntimos inteiros (`amountCents`).
- Motor de alocações (Manual e FIFO automático) com bloqueio contra sobre-alocação (>100%).
- Extrato progressivo acumulado e análise de antiguidade da dívida (*Aging*) em 5 escalões.
- Impressão A4 formatada e envio por email através do tenant com registo no histórico 360º.

---

## 2. Modelos de Dados & Migração PostgreSQL

### 2.1 Migração `20261009070000_crm_b7_account_entries`
- **Tabela `crm_account_entries`**:
  - `id` (PK, text cuid)
  - `tenantId` (FK -> `tenants`, ON DELETE RESTRICT)
  - `companyId` (FK -> `crm_companies`, ON DELETE RESTRICT)
  - `entryDate` (timestamp default now)
  - `type` (`OPENING_BALANCE`, `INVOICE`, `DEBIT_NOTE`, `CREDIT_NOTE`, `PAYMENT`, `REFUND`, `ADJUSTMENT`, `REVERSAL`)
  - `externalDocumentNumber` (texto identificador do ERP de faturação)
  - `dueDate` (timestamp de vencimento para débitos)
  - `amountCents` (inteiro positivo em cêntimos)
  - `method` (método de pagamento: `TRANSFER`, `MBWAY`, `MULTIBANCO`, `CARD`, `CASH`, `DIRECT_DEBIT`, `OTHER`)
  - `reference`, `notes`, `proposalId`
  - `reversesEntryId` (FK autorreferencial para estornos)
  - `createdBy`, `isReversed`, `reversedAt`, `createdAt`
  - Índices: `[tenantId, companyId]`, `[tenantId, entryDate]`, `[tenantId, type]`, `[reversesEntryId]`

- **Tabela `crm_account_allocations`**:
  - `id` (PK, text cuid)
  - `tenantId` (FK -> `tenants`, ON DELETE RESTRICT)
  - `companyId` (FK -> `crm_companies`, ON DELETE RESTRICT)
  - `paymentEntryId` (FK -> `crm_account_entries`, ON DELETE RESTRICT)
  - `documentEntryId` (FK -> `crm_account_entries`, ON DELETE RESTRICT)
  - `amountCents` (inteiro em cêntimos)
  - `isCancelled`, `cancelledAt`, `createdAt`
  - Índices: `[tenantId, companyId]`, `[paymentEntryId]`, `[documentEntryId]`

- **Triggers de Imutabilidade**:
  - `trg_crm_account_entry_guard`: Levanta exceção e impede qualquer operação `DELETE` em `crm_account_entries`. Em operações `UPDATE`, bloqueia mutações nos dados essenciais (`amountCents`, `type`, `companyId`, `tenantId`, `entryDate`, etc.), permitindo apenas marcações de estorno (`isReversed`, `reversedAt`).
  - `trg_crm_account_alloc_guard`: Impede `DELETE` em `crm_account_allocations` e protege atributos fundamentais da alocação.

- **Defesa em Profundidade (`tenantScopedClient.ts`)**:
  - `CrmAccountEntry` e `CrmAccountAllocation` adicionados a `TENANT_SCOPED_MODELS`.

---

## 3. Endpoints de API Criados

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/crm/companies/:id/account/statement` | Extrato progressivo com saldo acumulado e filtros |
| `GET` | `/api/crm/companies/:id/account/balances` | Posição financeira e análise de antiguidade (*Aging*) |
| `GET` | `/api/crm/companies/:id/account/statement/print` | Renderização HTML A4 pronta para impressão |
| `POST` | `/api/crm/companies/:id/account/statement/send` | Envio de extrato por email através do tenant |
| `POST` | `/api/crm/companies/:id/account/entries` | Registo de lançamento (com auto-alocação FIFO opcional) |
| `POST` | `/api/crm/companies/:id/account/allocate` | Alocação manual de pagamento a documento pendente |
| `POST` | `/api/crm/account/entries/:id/reverse` | Estorno imutável de lançamento com cancelamento de alocações |
| `GET` | `/api/crm/account/balances/summary` | Resumo financeiro global do tenant e lista de devedores |

---

## 4. Evidência dos Testes Automatizados (100% Verde)

```
✔ Fase B7 — Conta Corrente: Validação e Lançamento de Débito (INVOICE) (231.7ms)
✔ Fase B7 — Conta Corrente: Extrato com Débito, Pagamento e Saldo Progressivo (30.0ms)
✔ Fase B7 — Conta Corrente: Alocação Manual e Bloqueio de Sobre-alocação (39.3ms)
✔ Fase B7 — Conta Corrente: Alocação Automática FIFO a Faturas em Aberto (41.4ms)
✔ Fase B7 — Conta Corrente: Estorno (REVERSAL) anula efeito e cancela alocações (25.5ms)
✔ Fase B7 — Conta Corrente: Cálculo de Saldos Vencidos e Antiguidade (Aging) (38.3ms)
✔ Fase B7 — Conta Corrente: Isolamento Multi-tenant Estrito (404 Not Found) (14.4ms)
✔ Fase B7 — Conta Corrente: Extrato HTML A4 com Salvaguarda Legal e Sem Termos Fiscais (41.6ms)

Total da Suite Conjunta:
ℹ tests 95
ℹ suites 24
ℹ pass 95
ℹ fail 0
```

- `npm run typecheck`: **0 erros**.
- `npx eslint src/modules/crm`: **0 erros**.

---

## 5. Evidência do Deploy e Smoke Tests em Produção

- **Vercel Target:** Production (`https://helderlabs.eu`)
- **Deployment ID:** `dpl_7mXoTMZNmVgGJCq32V4vqPJGUbSW`
- **Smoke Tests Reais:**
  - `GET https://helderlabs.eu/app.html` -> **HTTP 200**
  - `GET https://helderlabs.eu/api/crm/companies/test/account/statement` -> **HTTP 401** (Autenticação e isolamento confirmados)
  - `GET https://helderlabs.eu/assets/js/crm/crm-account.js?v=1.6.7` -> **HTTP 200**
  - `GET https://helderlabs.eu/api/crm/account/balances/summary` -> **HTTP 401**

---

## 6. Governação & Registo Histórico

- `CHANGELOG.md` atualizado com a versão `[v1.6.7]`.
- `DECISOES.md` atualizado com o **ADR 009**: *Conta Corrente Sem Faturação e Imutabilidade Contabilística Estrita*.
- `DIARIO.md` atualizado com o registo de execução da Fase B7.
