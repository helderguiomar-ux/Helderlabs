# Arquitetura de Referência — HELDERLABS ERP

Este documento apresenta a arquitetura oficial da plataforma empresarial **HELDERLABS ERP (v0.2.0)**.

---

## 🏗️ 1. Visão Geral das Camadas do Sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CAPA DE APRESENTAÇÃO (FRONTEND)                    │
│   Landing Page      User Workspace      ERP Shell      Super Admin      │
│   (index.html)     (workspace.html)     (app.html)  (super-admin.html)  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP / REST / Fastify Static
┌────────────────────────────────────▼────────────────────────────────────┐
│                       CAMADA DE API & SEGURANÇA                         │
│  Fastify 4 Framework + TypeScript Strict + @fastify/helmet + rate-limit │
│  Guards: authenticate (JWT) | requireApp(key) | requirePermission(perm)  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                    CAMADA DE SERVIÇOS DA PLATAFORMA                     │
│  • EntitlementService (Resolução Tenant -> App -> User + HMAC Signature)│
│  • AuditService (Hash Chain SHA-256 por Tenant + Audit Trail)          │
│  • Impersonation Manager (Sessões de suporte em modo Read-Only)         │
│  • Module Registry (module.manifest.ts por aplicativo)                  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│                   CAMADA DE DADOS & MULTI-TENANCY                       │
│  Prisma ORM 5 + Extensão tenantScopedClient.ts (Injeção automática)     │
│  Base de Dados PostgreSQL Cloud (Neon DB)                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 2. Componentes Principais do Backend

### 2.1 Fastify Application Builder (`backend/src/app.ts`)
- **Framework**: Fastify v4.29.1 em TypeScript Strict Mode.
- **Middlewares Globais**:
  - `@fastify/helmet` (Headers HTTP seguros: HSTS, CSP, Frameguard, X-Content-Type-Options).
  - `@fastify/rate-limit` (Proteção contra Brute-Force em endpoints sensíveis como OTP/Login).
  - `@fastify/cors` (Controlo de origens permitidas via `ALLOWED_ORIGINS`).
  - `setErrorHandler` unificado para captura padronizada de Zod errors (400), AppErrors (4xx) e DB errors (503).

### 2.2 Entitlement Engine & Manifest (`EntitlementService.ts`)
- **Manifesto do Utilizador (`GET /api/me/workspace`)**: Devolve a lista consolidada de aplicações licenciadas para o tenant, permissões efetivas do utilizador, quotas de consumo e uma **assinatura HMAC-SHA256** do estado para prevenir tampering no cliente.
- **Cascata de Entitlements**:
  1. Estado do Tenant (`status == ACTIVE`).
  2. Licenciamento do Módulo (`ApplicationInstance.status != DISABLED`).
  3. Período de Grace (`graceEndsAt`).
  4. Permissões Globais vs. Específicas do Utilizador.
- **Cache**: Resoluções mantidas em memória com TTL de 60s e invalidação instantânea via `invalidateCache(tenantId)`.

### 2.3 Backend Enforcement Guards (`plugins/entitlements.ts`)
- **`requireApp(moduleKey)`**: Valida se o módulo está ativo e licenciado para o tenant antes de executar a rota. Retorna `403 APP_NOT_LICENSED` se desativado, ou `403 APP_READ_ONLY` se suspenso e o método for mutativo (`POST`/`PUT`/`DELETE`).
- **`requirePermission(permissionKey)`**: Garante que o utilizador autenticado possui a permissão requerida no seu perfil.

### 2.4 Extensão Multi-Tenant do Prisma (`tenantScopedClient.ts`)
- Extende o cliente Prisma injetando automaticamente o filtro `{ where: { tenantId } }` em operações de leitura (`findMany`, `findFirst`, etc.) e carimbando `data.tenantId` em operações de criação (`create`, `createMany`).
- Impede acesso cruzado entre dados de empresas distintas a nível da camada de acesso a dados.

### 2.5 Audit Logging com Cadeia de Hash SHA-256 (`AuditService.ts`)
- Registos de auditoria gravados sequencialmente por tenant.
- Cada registo calcula `hash = SHA256(tenantId + sequenceNum + previousHash + action + payload)`.
- O método `verifyAuditChain(tenantId)` valida a integridade contínua da cadeia de registos.

---

## 💻 3. Frontend & Module Manifest Contract

Cada módulo corporativo (ex.: `crm`, `condominios`) define um contrato estático `module.manifest.ts`:
- **Chave Única**: `key` (ex.: `"crm"`).
- **Metadados**: Nome, versão, ícone, rota de entrada, rotas API protegidas.
- **Permissões Declaradas**: Ações suportadas (`read`, `write`, `export`, `admin`).
- **Limites Declarados**: Metadados de quota (ex.: `maxLeads`, `maxStorageMB`).

O **User Workspace Launcher (`workspace.html`)** consome o endpoint `GET /api/me/workspace` para renderizar dinamicamente os cartões de aplicações disponíveis, aplicadores de tema CSS do tenant (`TenantBranding`), atalhos globais (`Ctrl+K`) e modal de administração da empresa.
