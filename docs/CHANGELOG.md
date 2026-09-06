# CHANGELOG — HELDERLABS ERP

All notable changes to the HELDERLABS ERP platform will be documented in this file.

## [v0.2.0] - 2026-09-06

### 🛡️ Phase 0: Security Remediation
- Removed insecure `/demo-login` and `/demo-status` endpoints.
- OTP codes hashed with `bcrypt`, 15-minute expiration, 5 max attempts limit.
- Dev master OTP `123456` strictly locked to non-production dev mode (`ALLOW_DEV_MASTER_OTP=true`).
- Security middleware added: `@fastify/helmet` (v11) and `@fastify/rate-limit` (v8).

### 🗄️ Phase 1: Data Model & Schema Consolidation
- Extended Prisma Schema: `Module.key`, `ApplicationInstance` limits/status/grace, `TenantBranding`, `ImpersonationSession`, `AuditLog` sequenceNum & hash chain, `Tenant.entitlementsVersion`.
- Safely pushed schema changes to Neon DB without data loss (`prisma db push`).

### 🔑 Phase 2: Entitlement Engine & Workspace Manifest
- `EntitlementService` cascading resolution (Tenant -> ApplicationInstance -> User Permissions).
- HMAC-SHA256 signature attached to workspace manifest (`GET /api/me/workspace`).
- In-memory cache with TTL and instant invalidation (`invalidateCache`).

### 🛡️ Phase 3: Backend Enforcement Guards
- Fastify decorators: `requireApp(moduleKey)` and `requirePermission(perm)`.
- Protected `crm` and `condominios` routes; extracted unauthenticated public lead creation (`POST /api/crm/public/leads`).

### 🖥️ Phase 4: User Workspace Launcher & UI Shell
- `workspace.html`: App launcher, tenant administration modal, consumption badges, global search (`Ctrl+K`), custom branding properties.
- `module.manifest.ts` contract for `crm` and `condominios`.
- Post-login flow redirects to `/workspace.html`.

### 👑 Phase 5: Super Admin Control Plane & Impersonation
- Impersonation endpoints: `POST /api/platform/impersonate` and `POST /api/platform/impersonate/end`.
- Support sessions restricted to read-only mode (`IMPERSONATION_READ_ONLY`).
- 1-click user account request approval (`POST /api/platform/account-requests/:id/approve`).

### 📜 Phase 6: Audit Logging with SHA-256 Hash Chain
- `AuditService` sequential hash chaining: `hash = SHA256(tenantId + sequenceNum + previousHash + action + payload)`.
- Implemented `verifyAuditChain(tenantId)` for cryptographic tamper verification.

### 🧪 Phase 7 & 8: Test Suite & Documentation
- 44 unit and integration tests passing 100%.
- Strict TypeScript validation passing with 0 errors (`npm run typecheck`).
- Fully updated documentation (`CLAUDE.md`, `Architecture.md`, `Security.md`, `CHANGELOG.md`).
