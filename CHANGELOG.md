# CHANGELOG — HELDERLABS ERP

Todas as alterações notáveis do repositório unificado **HELDERLABS ERP** são registadas neste ficheiro.

---

## [v0.2.0] - 2026-09-06

### 🛡️ Fase 0: Correções Críticas de Segurança
- **Remoção de Endpoints Inseguros**: Eliminadas rotas `/demo-login` e `/demo-status`.
- **OTP Hashing & Expiração**: Códigos OTP agora cifrados com `bcrypt`, validade restrita a 15 minutos e máximo de 5 tentativas falhadas (`OtpCode`).
- **Dev Master OTP**: Código mestre `123456` estritamente restrito a desenvolvimento local (`ALLOW_DEV_MASTER_OTP=true` e `NODE_ENV !== 'production'`).
- **Segurança HTTP & Rate Limiting**: Adicionados `@fastify/helmet` (v11) para headers HTTP seguros (CSP, HSTS) e `@fastify/rate-limit` (v8) para mitigar força bruta.
- **Passwords Padrão Removidas**: Eliminadas passwords codificadas no código.

### 🗄️ Fase 1: Modelo de Dados & Schema Consolidados
- **Schema Prisma Expandido**:
  - `Module.key` como identificador único.
  - `ApplicationInstance` com campos `status`, `usageLimits`, `features`, `planKey`, `graceEndsAt`.
  - `TenantBranding` para personalização de marca por empresa (logotipo, cores primária/secundária).
  - `ImpersonationSession` para auditoria de sessões de suporte Super Admin.
  - `AuditLog` com campos `sequenceNum` e `hash` para integridade em cadeia.
  - `Tenant.entitlementsVersion` para controlo de versão e invalidação de cache.
  - Removida tabela obsoleta `TenantModule`.
- **Migração Não-Destrutiva**: Sincronizado com a Neon Cloud DB via `prisma db push` e `seed.ts` atualizado.

### 🔑 Fase 2: Entitlement Engine & Workspace Manifest
- **`EntitlementService`**: Implementada resolução em cascata (Tenant -> ApplicationInstance -> User Permissions).
- **Assinatura HMAC-SHA256**: Manifesto assinado com HMAC para validação no cliente.
- **Cache em Memória**: TTL de 60s com suporte a invalidação instantânea (`invalidateCache`).
- **Endpoint Manifest**: Criado `GET /api/me/workspace` devolvendo os cartões de apps ativas, permissões do utilizador e dados de branding.

### 🛡️ Fase 3: Backend Enforcement Guards
- **Guards de Fastify**: Criado `plugins/entitlements.ts` exportando `requireApp(moduleKey)` e `requirePermission(perm)`.
- **Proteção de Módulos**: Módulos `crm` e `condominios` protegidos com `requireApp`.
- **Public Lead Form**: Isolada a rota pública `POST /api/crm/public/leads` para recolha de contactos na Landing Page sem necessidade de token JWT.

### 🖥️ Fase 4: User Workspace Launcher & UI Shell
- **`workspace.html`**: Novo hub central de aplicativos e zona de administração do tenant. Inclui atalho global (`Ctrl+K`), visualização de limites de consumo, badges de estado e personalização visual via CSS Custom Properties.
- **Contratos de Módulo**: Criados `crm/module.manifest.ts` e `condominios/module.manifest.ts`.
- **Redirecionamento Pós-Login**: Atualizado `login.html` para redirecionar utilizadores autenticados para `/workspace.html`.

### 👑 Fase 5: Control Plane Super Admin & Impersonation Auditada
- **Endpoints de Impersonation**: Criados `POST /api/platform/impersonate` e `POST /api/platform/impersonate/end`.
- **Modo Só Leitura**: Sessões de suporte impõem `IMPERSONATION_READ_ONLY` para bloquear qualquer mutação na BD do cliente durante o suporte.
- **Aprovação em 1-Clique**: Criado `POST /api/platform/account-requests/:id/approve` para aprovação instantânea de registos pendentes.

### 📜 Fase 6: Audit Logging com Hash Chain (SHA-256)
- **`AuditService`**: Gravação sequencial de auditoria com cálculo de `hash = SHA256(tenantId + sequenceNum + previousHash + action + payload)`.
- **Integridade Detetável**: Função `verifyAuditChain(tenantId)` para validação de integridade criptográfica.

### 🧪 Fase 7 & 8: Testes Automatizados & Documentação
- **100% Testes Aprovados**: 44 testes unitários e de integração verdes (`npm test`).
- **Zero Erros TypeScript**: `npm run typecheck` estrito aprovado.
- **Documentação Atualizada**: `CLAUDE.md`, `docs/Architecture.md`, `docs/Security.md`, `docs/PRODUCTION_AUDIT_RECOMMENDATIONS.md` e `CHANGELOG.md` sincronizados.

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
