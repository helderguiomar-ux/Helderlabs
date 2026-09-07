# Mapa Oficial de Módulos — HELDERLABS ERP v0.3.0

> **Mapa de Estado Real de Módulos (Sem Margem para Otimismo)**
> Data: 2026-09-07 | Diretoria: `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## Tabela Resumo de Módulos

| Chave | Nome (PT / EN) | Estado Real | Rota de Entrada | Licenciável | Depende De |
|---|---|---|---|---|---|
| `financas` | Gestão Financeira / Financial Management | `beta` | `/app.html#financas` | **Sim** | `platform` |
| `audit` | Registos de Auditoria / Activity & Audit Logs | `ativo` | `/app.html#audit` | **Sim** | `platform` |
| `crm` | CRM & Oportunidades / CRM & Deals | `beta` | `/app.html#crm` | **Sim** | `platform` |
| `condominios` | Gestão de Condomínios / Condominium Mgmt | `em_construcao` | `/app.html#condominios` | **Não** | `platform` |
| `rent_a_car` | Rent-a-Car & Frotas / Car Rental | `planeado` | `/app.html#rent_a_car` | **Não** | `platform` |
| `super_admin` | Painel de Plataforma / Platform SuperAdmin | `ativo` | `/super-admin.html` | **Não** | Sistema |

---

## Detalhe de Cada Módulo

### 1. `financas` — Gestão Financeira v2
- **Chave**: `financas`
- **Estado Real**: **`beta`** (O percurso principal funciona de ponta a ponta com dados reais PostgreSQL, inteiros de cêntimos e isolamento na app via `tenantScopedClient.ts`; em transição para verificação de RLS nativo com papel de BD não-owner).
- **O que já funciona**:
  - Movimentos (Receitas e Despesas) com soft delete (`deleted_at`), banner de Undo (10s) e atalhos de teclado.
  - Contas Bancárias & Transferências internas excluídas do cálculo de receitas/despesas mensais.
  - Orçamentos por Categoria com alertas em 3 níveis (80% aviso, 90% urgente, 100%+ excedido).
  - Objetivos de Poupança (`goals`) com depósitos em tempo real.
  - Dívidas e Passivos (`debts`) com calculador de prestação e modal de amortização.
  - Relatórios de Evolução Mensal e Repartição por Categoria (Recharts).
  - Exportação de Movimentos para CSV com codificação UTF-8 e registo em auditoria SHA256.
- **O que falta**: Emissão direta de Faturas Certificadas SAF-T (planeado para v3).

### 2. `audit` — Registos de Auditoria SHA256
- **Chave**: `audit`
- **Estado Real**: **`ativo`**
- **O que já funciona**:
  - Registo em tempo real de mutações financeiras, acessos e alterações de licença.
  - Encadeamento sequencial de hashes SHA256 na tabela `audit_log`.
  - Consolidação mensal de ficheiros JSONL com assinaturas `.sha256`.
  - CLI de verificação de integridade (`npm run audit:verify`).

### 3. `crm` — CRM & Oportunidades
- **Chave**: `crm`
- **Estado Real**: **`beta`**
- **O que já funciona**:
  - Entrada de leads a partir do formulário de diagnóstico da landing page (`POST /api/public/leads`).
  - Listagem de oportunidades e fichas de cliente.
- **O que falta**: Importação em massa de ficheiros CSV de contactos e integração com email automático.

### 4. `condominios` — Gestão de Condomínios
- **Chave**: `condominios`
- **Estado Real**: **`em_construcao`**
- **O que já funciona**:
  - Ecrãs de lista de edifícios e frações no frontend.
- **O que falta**: Emissão e liquidação automática de notas de cobrança de quotas e mapas de água.

### 5. `rent_a_car` — Rent-a-Car & Frotas
- **Chave**: `rent_a_car`
- **Estado Real**: **`planeado`**
- **O que já funciona**: Apenas a definição de entrada e conceito.
- **O que falta**: Contratos de aluguer, disponibilidade de frota e inventário de danos.

### 6. `super_admin` — Gestão de Plataforma
- **Chave**: `super_admin`
- **Estado Real**: **`ativo`**
- **O que já funciona**:
  - Ecrã de aprovação atómica de inscrições públicas (`/signup`).
  - Atribuição e suspensão de licenças por módulo.
  - Impersonation de utilizadores para suporte técnico com registo auditado.
