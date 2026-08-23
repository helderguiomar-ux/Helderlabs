# CHANGELOG — HELDERLABS ERP

Todas as alterações notáveis do repositório unificado **HELDERLABS ERP** são registadas neste ficheiro.

---

## [v0.1.0] - 2026-08-23

### 📌 Versão Canónica Única & Consolidação de Repositório
- **Versão Canónica Única v0.1.0**: Estabelecida a diretoria `C:\Users\helde\Desktop\Dev\helderlabs-erp` como a única fonte canónica oficial de código para GitHub, Claude, Antigravity e ambiente local.
- **Base de Dados Online**: Vinculada a base de dados em nuvem Neon Cloud PostgreSQL via `DATABASE_URL` no `.env`.
- **Eliminação de Duplicados**: Auditados e removidos todos os diretórios obsoletos e cópias duplicadas nas drives C: e G: (`G:\O meu disco\01_HelderLabs\...` e `G:\O meu disco\01_HeldersLabs\...`).
- **Vinculação Git Remote**: Repositório Git local associado diretamente ao repositório remoto `https://github.com/helderguiomar-ux/Helderlabs.git`.

## [v1.0.0-consolidada] - 2026-08-23

### 🚀 Consolidação Unificada & Preparação para Produção
- **Adaptação Vercel Serverless**: Criado `api/index.ts` na raiz como entrada de Serverless Function nativa para a Vercel, permitindo a execução do Fastify sem dependência de um servidor HTTP escutando portas.
- **Configuração de Build Vercel**: Atualizado `vercel.json` com `buildCommand: "cd backend && npm install && npx prisma generate && npm run build"` e rewrites estáticos/API corrigidos para `/api/index`.
- **ErrorHandler Unificado & Zod**: Fundido o `setErrorHandler` em `backend/src/app.ts`. Validações Zod retornam `400 Bad Request` com mapa de erros, e indisponibilidade de BD retorna `503 Service Unavailable`.
- **CORS Dinâmico**: Adicionado suporte a `ALLOWED_ORIGINS` CSV configurável por ambiente (`https://helderlabs.eu`).

### 🔑 Autenticação, Resend & Super Admin
- **Integração API Resend**: Envio direto de emails transacionais com código de verificação OTP de 6 dígitos via `https://api.resend.com/emails` quando `RESEND_API_KEY` estiver definida.
- **Definição de Password**: Implementado o endpoint `/set-password` cifrando a palavra-passe com `bcrypt` (10 rounds) e guardando em `passwordHash` no PostgreSQL.
- **Auto-provisioning do Super Admin**: Garantido que o email `helderguiomar@gmail.com` é auto-promovido para `SUPER_ADMIN` no Tenant de Sistema `helderlabs-platform` sem bloqueios.
- **Gate de Aprovação (`PENDING_APPROVAL`)**: Novas contas registadas ficam no estado `PENDING_APPROVAL`, sendo impedidas de aceder a módulos do ERP (`/app.html`) até serem aprovadas e atribuídas a uma empresa (Tenant) pelo Super Admin.

### 📦 Sistema de Módulos como Aplicativos
- **Schema Prisma Expandido**: Adicionados os modelos `ApplicationInstance` e `ApplicationAssignment` com enums `ApplicationStatus` (`DISABLED`, `TRIAL`, `ACTIVE`, `ARCHIVED`) e `ApplicationAssignmentStatus`.
- **API Platform Applications**: Criado `ApplicationController.ts` e `applications.routes.ts` com endpoints sob `/api/platform/applications`.
- **Interface Super Admin**: Nova aba **"📦 Aplicativos & Módulos"** em `super-admin.html` permitindo a gestão em tempo real de instâncias ativas por tenant.
- **Seed de Demonstração**: Criado `backend/prisma/seed.ts` com 3 empresas fictícias (Consultoria Alfa, Administra Condo, StartUp Inovação), 7 utilizadores e dados de demonstração.

### 📄 Documentação & Suporte a Agentes IA
- Criado `CLAUDE.md` com instruções detalhadas para o Claude Code / Antigravity.
- Criado `docs/PRODUCTION.md` com guia de infraestrutura, backup, rollback e disaster recovery.
- Atualizado `README.md` com a secção completa `Production Deployment`.
