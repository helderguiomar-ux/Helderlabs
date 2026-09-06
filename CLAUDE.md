# CLAUDE.md — Guia do Agente IA para HelderLabs ERP

Este ficheiro contém as regras, arquitetura e instruções completas para qualquer agente IA (Claude, Antigravity, GitHub Copilot) ou desenvolvedor trabalhar com segurança neste projeto.

> **VERSÃO CANÓNICA OFICIAL: v0.2.0 (Com Separação Estrita de Ambientes)**
> **Diretoria Única Canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Base de Dados Local:** PostgreSQL 18 Local (`localhost:5432` / Docker)
> **Base de Dados Produção:** Neon Cloud PostgreSQL (Vercel Managed)

---

## 🏛️ 1. ARQUITETURA DO PROJETO & AMBIENTES

- **Framework Backend**: Node.js + Fastify 4 + TypeScript (Strict Mode)
- **ORM & BD**: Prisma ORM v5 com PostgreSQL Local (Multi-tenant via Client Extension `tenantScopedClient.ts`)
- **Guarda de Base de Dados**: `guard-db.mjs` interseta comandos destrutivos e recusa conexões que não sejam `localhost`.
- **Entitlement Engine**: `EntitlementService` com resolução hierárquica (Tenant -> App -> User), assinaturas HMAC-SHA256, in-memory TTL caching e `GET /api/me/workspace`.
- **Backend Protection Guards**: `@fastify/rate-limit`, `@fastify/helmet`, `requireApp(key)` e `requirePermission(perm)` preHandler decorators.
- **Audit System**: `AuditService` com tamper-evident SHA-256 hash chaining sequencial por tenant e `verifyAuditChain`.
- **Frontend**: SPA Estático e Workspace Launcher (`workspace.html`, `app.html`, `login.html`, `super-admin.html`) em HTML5/CSS3/Vanilla JS (ES2023) servido por `@fastify/static` em `/public` e desacoplado para Vercel Static Hosting.
- **Serverless Adapter**: `api/index.ts` (raiz) compõe a app Fastify sem escutar portas, emitindo eventos `request` nativos para a Vercel.
- **Standalone Mode**: `backend/src/server.ts` escuta em `PORT` (3333) para dev local, Docker ou Render.com.

---

## 📁 2. ESTRUTURA DE PASTAS CRÍTICAS

```
helderlabs-erp/
├── api/
│   └── index.ts                 ← Adapter Serverless Vercel (NÃO REMOVER)
├── docker-compose.yml           ← Serviço PostgreSQL 18 Local em Docker
├── backend/
│   ├── src/
│   │   ├── app.ts               ← Builder principal Fastify (ErrorHandler, CORS, DB Guard, Rotas)
│   │   ├── server.ts            ← Servidor HTTP standalone (Local/Docker/Render)
│   │   ├── websocket.ts         ← Servidor Socket.io para monitorização em tempo real
│   │   ├── database/
│   │   │   └── prisma/
│   │   │       ├── client.ts    ← Singleton Prisma Client + checkDatabaseReady()
│   │   │       └── tenantScopedClient.ts ← Extensão multi-tenant automática
│   │   ├── plugins/
│   │   │   ├── authenticate.ts  ← Fastify plugin de JWT, impersonation check e injeção request.db
│   │   │   └── entitlements.ts  ← Guards requireApp e requirePermission
│   │   └── modules/
│   │       ├── auth/            ← Autenticação (OTP seguro cifrado com bcrypt, Passwords, OAuth, Resend)
│   │       ├── crm/             ← Leads, Oportunidades, Clientes, Métricas, module.manifest.ts
│   │       ├── condominios/     ← Edifícios, Frações, Proprietários, Quotas, module.manifest.ts
│   │       └── platform/        ← Super Admin, EntitlementService, AuditService, Impersonation, Workspace Manifest
│   ├── scripts/
│   │   ├── guard-db.mjs         ← Guarda contra execuções destrutivas fora de localhost
│   │   ├── env-check.mjs        ← Validador de paridade de variáveis de ambiente
│   │   ├── db-mirror.mjs        ← Espelho de produção para local com anonimização
│   │   └── anonymize.sql        ← SQL de sanitização de dados pessoais em dumps
│   ├── public/                  ← Frontend estático
│   │   ├── index.html           ← Landing page institucional
│   │   ├── login.html           ← Ecrã de Login (Check Email, OTP, Set Password)
│   │   ├── workspace.html       ← User Workspace & App Launcher (Hub Multi-App + Tenant Admin)
│   │   ├── app.html             ← Shell legado do ERP
│   │   └── super-admin.html     ← Painel de controlo Super Admin (Gestão, Módulos, Impersonation)
│   ├── prisma/
│   │   ├── schema.prisma        ← Schema unificado PostgreSQL
│   │   ├── seed.ts              ← População de dados fictícios (4 cenários de tenant)
│   │   └── migrations/          ← Histórico de migrações SQL
│   └── tests/                   ← Testes automatizados (Node Test Runner nativo - 44 testes)
├── docs/                        ← Documentação histórica e técnica detalhada
│   ├── ENVIRONMENTS.md          ← Guia oficial de ambientes, deploy pipeline e rollback
│   ├── Architecture.md          ← Arquitetura de referência Fastify + Prisma + Entitlements
│   ├── Security.md              ← Framework de segurança (OTP, Rate Limit, Helmet, HMAC, Hash Chain)
│   └── PRODUCTION.md            ← Guia de Infraestrutura e Disaster Recovery
├── vercel.json                  ← Configuração de build, rewrites e serverless na Vercel
├── README.md                    ← Documentação principal do repositório
└── CLAUDE.md                    ← Este ficheiro de instruções para agentes IA
```

---

## 💻 3. COMANDOS IMPORTANTES

### Desenvolvimento Local (Base de Dados Local Protegida)
```bash
cd backend
npm run env:check         # Verifica paridade de variáveis com .env.example
npm run db:up             # Arranca container PostgreSQL local (se a usar Docker)
npm run db:migrate -- --name <descricao> # Gera e aplica migração localmente (com db:guard)
npm run db:seed           # Popula os 4 cenários de teste (com db:guard)
npm run dev               # Arranca servidor local em http://localhost:3333 (com db:guard)
```

### Validação e Testes
```bash
cd backend
npm run verify            # Executa typecheck estrito (tsc --noEmit) + 44 testes automatizados
```

### Deploy em Produção (Pipeline Seguro)
```bash
# Migrações em produção aplicam-se EXCLUSIVAMENTE via prisma migrate deploy no pipeline
cd backend
npm run db:deploy
```

---

## 🛡️ 4. REGRAS ABSOLUTAS PARA AGENTES IA

1. **GUARDA DE BASE DE DADOS**: Nunca tentar contornar a verificação de `guard-db.mjs`. Desenvolvimento local e comandos de migração dev DEVEM ser executados unicamente contra `localhost`.
2. **NÃO DESTRUIR DADOS**: Nunca executar `npx prisma migrate reset` ou `npx prisma db push --force-reset` em bases de dados de produção.
3. **ISOLAMENTO MULTI-TENANT**: Todos os novos models com relação com `Tenant` DEVEM ser registados na lista de modelos tenant-scoped em `backend/src/database/prisma/tenantScopedClient.ts`.
4. **PROTEÇÃO DE ROTAS E MÓDULOS**: Novas rotas de módulos corporativos DEVEM utilizar o preHandler `requireApp('moduleKey')`.
5. **NUNCA GUARDAR SECRETS NO GIT**: Ficheiros `.env`, `.env.local` e chaves reais devem estar sempre no `.gitignore`. Usar apenas placeholders na documentação.
6. **RETROCOMPATIBILIDADE**: As migrações de base de dados devem ser sempre retrocompatíveis para garantir que o Instant Rollback do código em produção permaneça seguro.
