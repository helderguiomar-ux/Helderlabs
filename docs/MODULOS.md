# Mapa Oficial de Módulos — HELDERLABS ERP v0.4.0

> **Mapa de Estado Real de Módulos (Sem Margem para Otimismo)**
> Data: 2026-09-08 | Versão: v0.4.0 | Diretoria: `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## Tabela Resumo de Módulos

| Chave | Nome (PT / EN) | Estado Real | Rota de Entrada | Licenciável | Depende De |
|---|---|---|---|---|---|
| `financas` | Gestão Financeira / Financial Management | **`ativo`** | `/app.html#financas` | **Sim** | `platform` |
| `audit` | Registos de Auditoria / Activity & Audit Logs | **`ativo`** | `/app.html#audit` | **Sim** | `platform` |
| `crm` | CRM & Empresa 360º / CRM & Company 360 | **`ativo`** | `/app.html#crm` | **Sim** | `platform` |
| `condominios` | Gestão de Condomínios / Condominium Mgmt | `em_construcao` | `/app.html#condominios` | **Não** | `platform` |
| `rent_a_car` | Rent-a-Car & Frotas / Car Rental | `planeado` | `/app.html#rent_a_car` | **Não** | `platform` |
| `super_admin` | Painel de Plataforma / Platform SuperAdmin | **`ativo`** | `/super-admin.html` | **Não** | Sistema |

---

## Detalhe de Cada Módulo

### 1. `financas` — Gestão Financeira v0.4.0 (Consolidação Canónica)
- **Chave**: `financas`
- **Estado Real**: **`ativo`** (Motor `FinanceCalcService` em cêntimos inteiros `amountCents`, isolamento multi-tenant estrito via `tenantScopedClient`, e projeção de tesouraria de 90 dias).
- **O que funciona a 100%**:
  - **Cockpit Financeiro (6 KPIs)**: Saldo Real em Caixa (com `openingBalanceCents` de contas), Receitas Realizadas, Despesas Realizadas, Resultado Líquido, Comprometido/Pendente, Saldo Disponível.
  - **Projeção de Fluxo de Caixa a 90 dias**: Unificação determinística de transações agendadas (`PLANNED`) e regras recorrentes projetadas em memória, com deteção do ponto mínimo de tesouraria e gráfico SVG nativo.
  - **Contas Financeiras & Caixa**: CRUD completo com soft-delete (`deletedAt`) e endpoint de restauro (`POST /:id/restore`).
  - **Centros de Custo**: Estrutura em árvore hierárquica (`parentId`) e relatórios de afetação.
  - **Categorias & Orçamentos**: Acompanhamento de execução orçamental mensal em tempo real com alertas visuais.
  - **Transações & Anexos**: Filtros avançados, liquidação rápida (`PATCH /pay`), aprovação de despesas (`PATCH /approve`), anexos documentais, e exportação CSV com auditoria SHA-256.
  - **Burn Rate & Runway**: Cálculo da média trimestral de queima de caixa e meses de autonomia financeira.

### 2. `audit` — Sistema de Auditoria Interna & Rastreabilidade Transversal
- **Chave**: `audit`
- **Estado Real**: **`ativo`**
- **O que funciona a 100%**:
  - Registo transversal automático via Fastify Hook (`onResponse`) de todas as mutações (`POST`, `PUT`, `PATCH`, `DELETE`) em todos os módulos (`financas`, `crm`, `condominios`, `platform`, `auth`).
  - Encadeamento sequencial de hashes SHA-256 imutáveis com deteção automática de adulterações (`AuditService.verifyAuditChain`).
  - Computação automática de diffs JSON (`oldValue` vs `newValue`) e modal de inspeção antes/depois no frontend.
  - Categorização em tempo real (`APPLICATION`, `SECURITY`, `DATABASE`, `USER`).
  - Histórico de auditoria por recurso (`/api/platform/audit/resource/:resource/:resourceId`).

### 3. `crm` — CRM & Diretório Empresa 360º
- **Chave**: `crm`
- **Estado Real**: **`ativo`**
- **O que funciona a 100%**:
  - **Ficha Empresa 360º (`Company`)**: Unificação de clientes, leads, fornecedores e parceiros com histórico transversal.
  - **Cálculo de Completude Progressiva (0-100%)**: Avaliação em tempo real do perfil cadastral e fiscal da empresa.
  - **Sub-recursos Estruturados**: Contactos com indicação de decisor/principal, Endereços múltiplos (Sede, Armazém, Faturação), Documentos com data de validade, Contratos e SLAs (com `monthlyValueCents`), e Relações societárias (Grupo/Filiais).
  - **Compatibilidade Integral**: Preservação dos fluxos legados de Leads e Oportunidades (`POST /api/public/leads`, conversão de lead em oportunidade e ganho comercial).

### 4. `super_admin` & Plataforma
- **Chave**: `super_admin`
- **Estado Real**: **`ativo`**
- **O que funciona a 100%**:
  - Gestão e aprovação atómica de novos pedidos de conta com OTP seguro (bcrypt) e verificação RGPD.
  - Licenciamento modular com cálculo de receita recorrente mensal (MRR) e anual (ARR) com suporte a descontos.
  - Sessão de suporte técnico (Impersonation) com proteção de modo de leitura e registo auditado.
