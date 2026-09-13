# AGENTS.md — Contexto Global & Diretivas de IA (HELDERLABS ERP)

Este documento define as regras arquiteturais, catálogo de ecrãs, registo de módulos e diretivas inegociáveis do projeto **HELDERLABS ERP**. Todos os agentes de Inteligência Artificial (Antigravity, Claude, ChatGPT, GitHub Copilot) devem ler e obedecer rigorosamente a estas especificações antes de modificar qualquer código.

---

## 🏛️ 1. Arquitetura em 10 Linhas

1. **Stack**: Node.js v20+ / TypeScript / Fastify backend modular + HTML5/CSS3/JS vanilla no frontend + PostgreSQL (Neon em produção, Docker local).
2. **Multi-Tenancy**: Isolamento estrito por `tenantId` nos dados. Todo o acesso a dados usa `tenantScopedClient.ts`.
3. **ORM**: Prisma Client. Proibido utilizar `PrismaClient` cru diretamente fora do `tenantScopedClient.ts`.
4. **Deploy**: Vercel Serverless (`https://helderlabs.eu`). O repositório GitHub `helderguiomar-ux/Helderlabs` na branch `master` é a **fonte única da verdade**.
5. **Base de Dados & Migrações**: O build na Vercel executa obrigatoriamente `prisma migrate deploy` (`node scripts/deploy-build.mjs`). É **estritamente proibido** utilizar `db push --accept-data-loss`.
6. **Autenticação**: Autenticação híbrida JWT (`signAuthToken`) por Email + Password ou Código OTP de 6 dígitos enviado por email (Resend API).
7. **SSO / OAuth**: Botões SSO (Google/Microsoft) mantêm-se visíveis com fallback 501 Not Implemented no backend (`/api/auth/google`).
8. **Módulos & Licensing**: Acesso condicionado via `EntitlementService.ts`. Rejeição com 403 `APP_NOT_LICENSED` se a empresa não possui licença.
9. **Design System**: Paleta "Caderno de Engenharia" baseada em CSS Tokens (`tokens.css`, `typography.css`, `components.css`).
10. **Internacionalização**: Suporte integral PT-PT / EN-US com paridade 1:1 rigorosa de chaves entre `pt.json` e `en.json`.

---

## 🖥️ 2. Catálogo dos 6 Ecrãs Principais

1. **`index.html`** — Landing Page pública da plataforma (SEO, Formulário de Lead comercial, Internacionalização, Apresentação da Plataforma).
2. **`login.html`** — Portal Corporativo de Autenticação (Login com Email + Password ou OTP, Alternância de Visibilidade com Olho SVG, Confirmação de Password e Solicitação de Acesso).
3. **`workspace.html`** — Painel de Controlo da Empresa (Banner de Licenciamento com status e validade, Manifesto Estrito de Módulos Licenciados, Atalho Ctrl+K, Alteração de Password com Modal e Definições de Empresa).
4. **`app.html`** — Aplicação SPA Unificada para execução dos módulos ERP ativos (CRM, Condomínios, Finanças).
5. **`hccall.html`** — Módulo de Telecomunicações & Vendas HCCALL (Gestão de Serviços, Objetivos por Serviço, Comissões, Agentes, Promoções e Análise de Desempenho).
6. **`super-admin.html`** — Consola de Administração Central da Plataforma HelderLabs (Gestão de Tenants com Edição de Dados, Aprovação de Contas, Atribuição de Módulos, Métricas de Armazenamento por Cliente, Auditoria de Saúde da BD, Backups e Impersonation com Banner de Suporte).

---

## 📦 3. Registo de Módulos e Estados

| Chave | Nome do Módulo | Estado no Sistema | Descrição |
| :--- | :--- | :--- | :--- |
| `crm` | CRM Comercial | `ACTIVE` | Gestão de Leads, Oportunidades, Contactos e Pipeline |
| `condominios` | Gestão de Condomínios | `IN_CONSTRUCTION` | Gestão de Frações, Atas, Quotas e Manutenção |
| `financas` | Gestão Financeira | `BETA` | Faturação, Tesouraria, Contabilidade e Recorrências |
| `hccall` | HCCALL Telecom | `ACTIVE` | Campanhas Telecom, Objetivos por Produto, Comissões e Vendas |
| `sellmais` | 2SELLMAIS | `ACTIVE` | Inventário de Antiguidades, Leilões, Providência e Avaliação com IA |
| `rent_a_car` | Frota & Aluguer | `PLANNED` | Gestão de Veículos, Contratos e Reservas |
| `rh` | Recursos Humanos | `PLANNED` | Gestão de Colaboradores, Processamento de Salários e Assiduidade |

---

## 🛡️ 4. Regras Inegociáveis (Strict Rules)

- **O Tenant vem da Sessão**: Nunca aceitar `tenantId` nos parâmetros da query ou body vindos do cliente; extrair sempre de `request.user.tenantId` (ou `actingUserId`/`actingTenantId` se em impersonation).
- **Restrição Estrita de Visibilidade de Módulos**: O tenant só pode ver módulos com licença efetiva (`ACTIVE`, `TRIAL`, `GRACE`, `SUSPENDED`). Módulos `NONE` e `DISABLED` nunca são enviados ao cliente do tenant, e `showUpsell` é sempre `false` para o tenant comum.
- **Indicação Clara de Licenciamento**: O tenant vê no topo do workspace o seu plano, estado, número de módulos licenciados e validade do contrato via `manifest.licensing`.
- **Edição de Tenants Auditada**: Alteração de dados cadastrais e operacionais de tenants ocorre exclusivamente via `PUT /api/platform/tenants/:id` com registo em `AuditService`.
- **Sem ESCRITAS sem Auditoria**: Toda as operações administrativas, mutações de dados e sessões de suporte registam evento no `AuditService` com hash chaining imutável.
- **NADA é Apagado**: Registos de sistema e dados de tenants utilizam eliminação lógica (`status = 'INACTIVE'` ou `deletedAt`) quando aplicável.
- **Paridade Tipográfica**: As quatro famílias de letra oficiais (`Archivo`, `Spectral`, `IBM Plex Mono`, `Caveat`) têm de carregar validadamente (`document.fonts.check`).
- **Zero Emojis na Interface**: Utilizar exclusivamente ícones SVG inline do design system.
- **Proteção Absoluta de Dados**: Estritamente proibido efetuar `DROP TABLE`, `TRUNCATE`, `DELETE` em massa ou `prisma migrate reset`.

---

## ⚙️ 5. Versão e Identificação
- **Versão Atual**: `1.5.0`
- **Commit em Produção**: `1e50983` (Verificado e Ativo em `https://helderlabs.eu`)
- **Ambiente**: Development / Staging / Production
