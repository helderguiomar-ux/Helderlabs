# CHANGELOG — HELDERLABS ERP

All notable changes to the HELDERLABS ERP platform will be documented in this file.

## [v3.1.1-RC1] - 2026-08-04

### 🚀 Landing Enterprise & UI
- Redesenho completo da Landing Page mantendo 100% de isolamento de módulos.
- Secção **"Sobre"** adicionada com destaque para 28+ anos de experiência executiva e frase-âncora *citizen developer*.
- Secção **"Resultados"** expandida com 4 cards de métricas reais anonimizadas (~400% Crescimento, 3 Anos Turnaround, ~40% Volume Comercial, 100% Autónomo).
- Formulação de Leads com submissão para API Serverless desacoplada (`/api/v1/leads`).

### 🔑 Identity & Access Management (IAM) & RBAC Granular
- Sistema RBAC avançado com **23 Roles Pré-Definidas** (*Super Administrator*, *Tenant Administrator*, *Sales Director*, *Auditor*, etc.).
- Suporte a permissões de 4 níveis totalmente configuráveis: `Role -> Module -> Resource -> Action`.
- Configuração dinâmica de Super Admin via `DEFAULT_SUPER_ADMIN_EMAIL`.

### 📈 CRM Enterprise & Pipeline Comercial
- Fluxo comercial estruturado de 7 fases: `Lead -> Qualification -> Opportunity -> Proposal -> Negotiation -> Won -> Customer`.
- Conversão automática de Lead/Oportunidade para Cliente no estado `WON` sem duplicação de dados.
- Timeline unificada de atividades e histórico por Cliente.
- Espaço documental categorizado (`CustomerDocument`) para contratos, propostas e anexos.

### 📧 Communications & Email Service Enterprise
- Caixa de correio completa com suporte a `INBOUND`/`OUTBOUND`, `Message-ID` e `Thread-ID` para agrupamento automático de conversas.
- Templates de e-mail com substituição dinâmica de variáveis (`{{Cliente}}`, `{{Empresa}}`, `{{Consultor}}`, `{{Data}}`).
- Rastreabilidade total no histórico de comunicações do CRM.

### 🛡️ Audit Trail Imutável
- Registo de auditoria em conformidade enterprise com `TimestampUTC`, `UserId`, `UserName`, `TenantId`, `CompanyId`, `IPAddress`, `Browser`, `OS`, `Endpoint`, `Table`, `Field`, `BeforeState`, `AfterState` e `CorrelationId`.

### 🔒 Segurança & Compliance
- Headers HTTP `CSP` e `HSTS` ativos.
- Cookies com `SameSite=Lax; HttpOnly; Secure`.
- Isolamento absoluto de dados Multi-Tenant por `tenantId`.
