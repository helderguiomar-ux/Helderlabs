# AUDITORIA TÉCNICA E PLANO DE EXECUÇÃO — HELDERLABS ERP v0.4.0
**Módulos:** Financeiro, CRM / Empresas e Sistema Central de Auditoria Interna  
**Data da Auditoria:** 2026-09-08  
**Autor:** Antigravity (Google DeepMind)  
**Diretoria Canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## 1. INVENTÁRIO REAL AUDITADO (BASE DE DADOS & CÓDIGO)

### 1.1 Contagens Reais na Base de Dados PostgreSQL Local:
| Entidade / Tabela | Contagem Real | Observações |
| :--- | :--- | :--- |
| `tenants` | 4 | 1 Plataforma + 3 Empresas Ativas |
| `users` | 9 | Super Admin, Gestores e Utilizadores |
| `leads` | 54 | CRM (inclui registos públicos desviados do AccountRequest) |
| `opportunities` | 16 | Pipeline comercial existente |
| `customers` | 1 | Cliente CRM |
| `communications` | 15 | Histórico de chamadas, notas e reuniões |
| `audit_logs` | 245 | Sistema existente com encadeamento SHA-256 |
| `finance_transactions` | 0 | Módulo canónico com cêntimos inteiros |
| `financial_transactions` | Tabela não criada na BD | Módulo B inconsistente (a ser removido do schema) |
| `account_requests` | 0 | Vazio devido ao desvio em login.html para /api/public/leads |
| `application_instances` | 10 | Licenciamentos existentes |

---

## 2. DIAGNÓSTICO DOS 31 BUGS & PROBLEMAS ESTRUTURAIS

### 2.1 Problemas Estruturais Críticos:
1. **Dois Módulos Financeiros a Competir (`financas` vs `finance`):**
   - Decisão: Consolidar 100% no modelo **A (`financas`)** com valores em cêntimos inteiros (`amountCents`), categorias dinâmicas em tabela e tenant scoping correto via `tenantScopedClient.ts`.
2. **Causa Raiz da Falta de Aprovações no Super Admin:**
   - `login.html` e `index.html` submetiam "Solicitar Acesso" para `/api/public/leads` em vez de `/api/public/register`.
   - Correção: Ligar o botão a `/api/public/register`, gerando o `AccountRequest` com consentimento RGPD e aprovação no painel Super Admin.
3. **Isolamento de Segurança Multi-Tenant (BUG-01 a BUG-07):**
   - Proteger todas as rotas financeiras com `requireApp('financas')`.
   - Restringir criação de licenças apenas a `SUPER_ADMIN`.
   - Hash de OTP com bcrypt (sem expor nos logs).
   - Índice único composto `[tenantId, documentNumber]`.
4. **Integridade de Dados & Soft Delete (BUG-08 a BUG-15):**
   - Implementar `deletedAt DateTime?` em todas as entidades (Transações, Empresas, Contactos, Categorias).
   - Eliminar `anonymizeGdpr` em massa desprotegido.
   - Normalizar a chave canónica do módulo para `financas`.

---

## 3. SISTEMA CENTRAL DE AUDITORIA INTERNA & RASTREABILIDADE

### 3.1 Infraestrutura Existente vs Melhorias:
- **Já Existia:** `AuditService` com encadeamento criptográfico SHA-256 (`prevHash` + `hash`), tabela `audit_logs` e verificação de cadeia (`verifyAuditChain`).
- **O que Estava em Falta:**
  1. Categorização formal (`SYSTEM`, `APPLICATION`, `SECURITY`, `DATABASE`, `API`, `USER`).
  2. Deteção e extração automática de `oldValue` vs `newValue` com visualização de diff campo a campo.
  3. Rastreabilidade automática via hooks/middleware Fastify (`onResponse` / `preHandler`) e extensão Prisma.
  4. Histórico por Registo (aba/seção "Histórico de Auditoria" em Empresas, Movimentos, Contratos, etc.).
  5. Atividade por Utilizador (na ficha de cada utilizador).
  6. Dashboard de Auditoria completo na Consola de Administração.
  7. Proteção contra modificação (logs somente leitura).

---

## 4. PLANO DE MIGRAÇÃO DO SCHEMA (ADITIVO E SEGURO)

Toda a alteração é aditiva (`NULL` ou `DEFAULT`). Nenhuma tabela ou coluna em uso é eliminada.
- **Novos Modelos:**
  - `Company` (unifica Lead/Customer com perfil progressivo 360º)
  - `CompanyContact`, `CompanyAddress`, `CompanyDocument`, `Contract`, `CompanyRelation`
  - `FinanceAccount` (contas bancárias / caixas com saldo inicial)
  - `CostCenter` (centros de custo em árvore)
  - `Role` e `RolePermissionLink` (perfis configuráveis dinâmicos)
- **Extensões a Modelos Existentes:**
  - `FinanceTransaction`: `accountId`, `transferToId`, `costCenterId`, `companyId`, `counterpartyName`, `documentNumber`, `approvalStatus`, `tags`, `deletedAt`.
  - `FinanceCategory`: `parentId`, `sortOrder`.
  - `AuditLog`: `module`, `category`, `sessionId`, `description`.

---

## 5. ROTEIRO DE EXECUÇÃO FASE A FASE

- **Fase 0:** Auditoria e Plano (Concluído neste documento).
- **Fase 1:** Segurança e Correções sem Risco (BUG-01 a BUG-07, BUG-14).
- **Fase 2:** Fluxo de Registo e Aprovação de Contas (Frontend + Backend).
- **Fase 3:** Migração Aditiva do Schema Prisma (Prisma Migrate).
- **Fase 4:** Consolidação Financeira e Adaptadores de Compatibilidade.
- **Fase 5:** Backend Financeiro Avançado (Previsão por `dueDate`, Contas, Orçamentos por Categoria, Insights).
- **Fase 6:** Backend CRM Empresa 360º (Contactos múltiplos, moradas, faturação, contratos, timeline).
- **Fase 7:** Licenciamento com Preços/MRR e Gestão de Perfis & Permissões.
- **Fase 8:** Sistema Central de Auditoria Interna (Middleware automático, Diff Antes/Depois, Histórico por Registo/Utilizador, Dashboard).
- **Fase 9:** Interface 10/10 (Modularização do `app.html`, SVG icons, Zero Emojis, Design System Caderno de Engenharia).
- **Fase 10:** Testes de Verificação, QA e Documentação Realista.
