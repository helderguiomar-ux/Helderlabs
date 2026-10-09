# Relatório Antigravity — CRM Fase B5: Gestão de Contratos de Avença, SLA e Renovações Automáticas (v1.6.5)

**Data:** 2026-10-09  
**Versão:** v1.6.5  
**Commit:** `8b01eb0`  
**Deploy Vercel:** `dpl_79s8hF42RSBRzWGesnHPAL9AcryW`  
**URL de Produção:** `https://helderlabs.eu`  

---

## 1. Âmbito Entregue

A **Fase B5** dotou o HelderLabs ERP de um módulo corporativo completo de **Gestão de Contratos de Avença, SLA e Renovações Automáticas**, integrado na Ficha 360º de Empresas e com visão agregada de Receita Recorrente (MRR e ARR).

### 1.1 Modelo de Dados (`schema.prisma` & Migração SQL)
- **Extensão do modelo `Contract`:**
  - `proposalId`: Ligação à proposta comercial que originou o contrato (`Proposal`).
  - `isIndefinite`: Suporte para contratos por tempo indeterminado.
  - `monthlyValueCents`: Valor mensal recorrente (MRR) normalizado em cêntimos.
  - `slaLevel`: Níveis de SLA padronizados (`STANDARD`, `BRONZE`, `SILVER`, `GOLD`, `PLATINUM`, `CUSTOM`).
  - `slaResponseHours` e `slaResolutionHours`: Métricas explícitas de resposta e resolução.
  - `renewalNoticeDays`: Pré-aviso configurável de renovação/rescisão.
  - `lastRenewedAt`: Carimbo temporal da última renovação contratual.
  - `cancelledAt` e `cancellationReason`: Rastreio formal de cancelamento/rescisão.
  - Índices aditivos: `@@index([tenantId, contractNumber])`, `@@index([tenantId, status])`, `@@index([tenantId, endDate])`.
- **Migração SQL:** `backend/prisma/migrations/20261009050000_crm_b5_contracts/migration.sql` aplicada com sucesso (100% aditiva, sem operações destrutivas).

### 1.2 Lógica de Negócio (`EnterpriseCRMService.ts`)
- **Numeração Sequencial Única:** Geração automática no formato `CTR-YYYY-XXXX` por tenant e ano.
- **Normalização de MRR e ARR:**
  - Frequências de faturação suportadas: `MONTHLY` (100%), `QUARTERLY` (/3), `SEMIANNUAL` (/6), `ANNUAL` (/12), `ONE_OFF` (0).
  - Cálculo automático de ARR: `MRR * 12`.
- **Cálculo de Prazos e Alertas:** Cálculo dinâmico de `daysUntilEnd` e flag `isExpiringSoon` (aviso de expiração nos próximos 30 dias).
- **Renovação Contratual:** Extensão de prazo, ajuste percentual de valor (indexação IPC/inflação), atualização de status para `ACTIVE` e registo automático de atividade na cronologia 360º.
- **Rescisão:** Registo de data e motivo obrigatório com transição de status para `CANCELLED`.
- **Salvaguarda Legal Imutável:** Minuta A4 com aposição obrigatória do aviso:
  > *"Resumo de Contrato Comercial de Prestação de Serviços / Avença. Não serve de fatura nem de documento de quitação fiscal."*

### 1.3 Interface Utilizador (`crm-contracts.js`, `crm-companies.js`, `app.html`, `crm.css`)
- **Painel de KPIs:** MRR Total, ARR Projetado, Contratos Ativos, Avenças a Expirar (<30 dias) e Minutas Pendentes de Assinatura.
- **Tabela de Contratos & Avenças:** Filtragem por estado e pesquisa com badges visuais de SLA (Bronze, Silver, Gold, Platinum).
- **Modais de Gestão:**
  - `Novo Contrato`: cálculo em tempo real de MRR baseado no valor e frequência de faturação.
  - `Renovar Contrato`: ajuste percentual de inflação/IPC e extensão de meses.
  - `Rescindir Contrato`: recolha obrigatória do motivo de rescisão.
- **Separador na Ficha 360º de Empresa:** Visualização dos contratos associados ao cliente com acesso direto a detalhes e criação.

---

## 2. Evidência de Testes

### 2.1 Suite Automatizada Local
```powershell
npx tsx --test tests/crm/*.test.ts tests/mail/*.test.ts
```
**Resultado:**
- Testes: **79 aprovados** (0 falhas)
- `tests/crm/crm-b5-contracts.test.ts`: **8/8 aprovados** cobrindo numeração sequencial, MRR, KPIs, renovação com ajuste percentual, rescisão e salvaguarda legal.

### 2.2 Verificação de Tipos e Linters
- `npm run typecheck`: **0 erros**
- `npx eslint src/modules/crm/services/EnterpriseCRMService.ts src/modules/crm/controllers/CRMController.ts src/modules/crm/routes/crm.routes.ts`: **0 erros**

---

## 3. Verificação em Produção (Vercel)

- **Deploy ID:** `dpl_79s8hF42RSBRzWGesnHPAL9AcryW`
- **Aliased:** `https://helderlabs.eu`
- **Smoke Tests:**
  - `curl.exe -sI https://helderlabs.eu/app.html` -> **HTTP 200 OK**
  - `curl.exe -sI https://helderlabs.eu/api/crm/contracts` -> **HTTP 401 Unauthorized** (validação de token JWT ativa)
  - `curl.exe -sI https://helderlabs.eu/assets/js/crm/crm-contracts.js?v=1.6.5` -> **HTTP 200 OK**
