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

## 🖥️ 2. Catálogo dos 5 Ecrãs Principais

1. **`index.html`** — Landing Page pública da plataforma (SEO, Formulário de Lead comercial, Internacionalização, Apresentação da Plataforma).
2. **`login.html`** — Portal Corporativo de Autenticação (Login com Email + Password ou OTP, Alternância de Visibilidade com Olho SVG, Confirmação de Password e Solicitação de Acesso).
3. **`workspace.html`** — Painel de Controlo da Empresa (Manifesto de Módulos Licenciados, Atalho Ctrl+K, Alteração de Password com Modal e Definições de Empresa).
4. **`app.html`** — Aplicação SPA Unificada para execução dos módulos ERP ativos (CRM, Condomínios, Finanças).
5. **`super-admin.html`** — Consola de Administração Central da Plataforma HelderLabs (Gestão de Tenants, Aprovação de Contas, Atribuição de Módulos, Impersonation e Audit Log).

---

## 📦 3. Registo de Módulos e Estados

| Chave | Nome do Módulo | Estado no Sistema | Descrição |
| :--- | :--- | :--- | :--- |
| `crm` | CRM Comercial | `ACTIVE` | Gestão de Leads, Oportunidades, Contactos e Pipeline |
| `condominios` | Gestão de Condomínios | `IN_CONSTRUCTION` | Gestão de Frações, Atas, Quotas e Manutenção |
| `financas` | Gestão Financeira | `BETA` | Faturação, Tesouraria, Contabilidade e Recorrências |
| `rent_a_car` | Frota & Aluguer | `PLANNED` | Gestão de Veículos, Contratos e Reservas |
| `rh` | Recursos Humanos | `PLANNED` | Gestão de Colaboradores, Processamento de Salários e Assiduidade |

---

## 🛡️ 4. Regras Inegociáveis (Strict Rules)

- **O Tenant vem da Sessão**: Nunca aceitar `tenantId` nos parâmetros da query ou body vindos do cliente; extrair sempre de `request.user.tenantId`.
- **Sem ESCRITAS sem Auditoria**: Toda as operações administrativas e de suporte registam evento no `AuditService`.
- **NADA é Apagado**: Registos de sistema e dados de tenants utilizam eliminação lógica (`status = 'INACTIVE'` ou `deletedAt`) quando aplicável.
- **Paridade Tipográfica**: As quatro famílias de letra oficiais (`Archivo`, `Spectral`, `IBM Plex Mono`, `Caveat`) têm de carregar validadamente (`document.fonts.check`).
- **Zero Emojis na Interface**: Utilizar exclusivamente ícones SVG inline do design system.
- **Trabalho por Ramos (Git Flow)**: Nunca enviar commits diretamente para `main`/`master` sem PR e verificações verdes no CI.

---

## ⚙️ 5. Versão e Identificação
- **Versão Atual**: `0.3.0`
- **Ambiente**: Development / Staging / Production
