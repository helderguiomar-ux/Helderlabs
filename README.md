# 🚀 HELDERLABS ERP — Unified Enterprise Repository
**Version:** 1.0.0-consolidada | **Architecture:** Multi-Tenant Modular B2B SaaS

Official consolidated repository for **HELDERLABS ERP**. Designed for seamless collaboration between **Claude**, **Antigravity**, **GitHub CI/CD**, and human developers.

---

## 🏗️ Architecture Overview

The system is built on a **Modular Fastify + TypeScript** core with **Prisma ORM (PostgreSQL)**, supporting both standalone Node.js execution (local/Docker/Render) and Serverless deployment (Vercel / Firebase).

```
helderlabs-erp/
├── backend/                   ← Fastify / Node.js / Prisma Backend
│   ├── api/index.ts           ← Vercel Serverless Function entrypoint
│   ├── src/                   ← Backend source code
│   │   ├── app.ts             ← Unified Fastify application & error boundary
│   │   ├── server.ts          ← Standalone HTTP server (local/Docker/Render)
│   │   ├── database/          ← Prisma Client & tenant isolation extension
│   │   └── modules/           ← CRM, Condomínios, Platform, Finance, etc.
│   ├── public/                ← Integrated static SPA frontend
│   │   ├── index.html         ← Landing page (conditional dev banner)
│   │   ├── login.html         ← Auth page (Email + OTP + OAuth)
│   │   ├── app.html           ← Main ERP Dashboard
│   │   └── super-admin.html   ← Platform Super Admin (Modules & Tenant App Management)
│   ├── prisma/
│   │   ├── schema.prisma      ← Unified Prisma Schema (+ Condomínios, + Applications)
│   │   ├── seed.ts            ← Mock data seeder (3 tenants, 7 users, 4 active apps)
│   │   └── migrations/        ← Prisma SQL migrations history
│   └── tests/                 ← 32 automated unit & integration tests
├── docs/                      ← Complete historical & architectural documentation
├── vercel.json                ← Vercel Serverless & Static Asset routing configuration
├── firebase.json              ← Firebase Hosting & Cloud Functions configuration
└── package.json               ← Root scripts & project orchestration
```

---

## 🛠️ Quick Start — Running Locally

### Prerequisites
- Node.js v18+ or v20+
- PostgreSQL running locally (port 5432) or remote PostgreSQL connection string

### 1. Installation
```bash
cd backend
npm install
```

### 2. Environment Setup
Create `backend/.env` (or `.env.local`):
```env
DATABASE_URL="postgresql://postgres:enterprise_password_2026@localhost:5432/helderlabs_erp"
PORT=3333
NODE_ENV=development
ENVIRONMENT=DEVELOPMENT
VERSION=1.0.0-consolidada
JWT_SECRET="dev_secret_key_change_in_production"
ALLOWED_ORIGINS="http://localhost:3333,http://localhost:3000,http://127.0.0.1:3333"
```

### 3. Database Migration & Seed
```bash
cd backend
npx prisma generate
npx prisma db push        # Sync database schema
npm run seed              # Seed mock tenants, users, and module applications
```

### 4. Start Local Development Server
```bash
cd backend
npm run dev
```

The server will start listening at **`http://localhost:3333`**:
- **Landing Page**: [http://localhost:3333](http://localhost:3333)
- **Login**: [http://localhost:3333/login.html](http://localhost:3333/login.html)
- **ERP Dashboard**: [http://localhost:3333/app.html](http://localhost:3333/app.html)
- **Super Admin**: [http://localhost:3333/super-admin.html](http://localhost:3333/super-admin.html)
- **Health Check**: [http://localhost:3333/api/health](http://localhost:3333/api/health)

---

## 🧪 Testing & Validation

Run the automated test suite (32 unit tests for multi-tenant isolation, CRM workflow, Condomínios, OAuth PKCE/state):
```bash
cd backend
npm test
```

Check TypeScript compilation:
```bash
cd backend
npm run typecheck
```

Build production bundle:
```bash
cd backend
npm run build
```

---

## ☁️ Deployment

### Deployment Option 1: Vercel (Recommended)
1. Connect the root GitHub repository to **Vercel**.
2. Vercel automatically reads `vercel.json` and builds `backend/api/index.ts` as a Serverless Function and `backend/public` as static assets.
3. Configure Environment Variables in Vercel Dashboard:
   - `DATABASE_URL` (Neon or Render managed PostgreSQL)
   - `JWT_SECRET` (production random 32-byte secret)
   - `ALLOWED_ORIGINS` = `https://helderlabs.eu,https://www.helderlabs.eu`
   - `ENVIRONMENT` = `PRODUCTION`

### Deployment Option 2: Render.com
Use `backend/render.yaml` for managed Render.com deployment with PostgreSQL database included.

### Deployment Option 3: Firebase Hosting
Use `firebase.json` for Firebase Hosting deployment with `/api/**` rewrites to Cloud Functions.

---

## 🔑 Demo Test Credentials (from Seed)

| Role / Tenant | Email | Password | Active Modules |
|---|---|---|---|
| **TENANT_ADMIN** (Alfa) | `ana@consultoria-alfa.pt` | `admin1234` | CRM (ACTIVE), Finance (TRIAL) |
| **SALES** (Alfa) | `carlos@consultoria-alfa.pt` | `admin1234` | CRM (ACTIVE) |
| **TENANT_ADMIN** (Condo) | `luisa@administracondo.pt` | `admin1234` | Condomínios (ACTIVE) |
| **TENANT_OWNER** (StartUp) | `bea@startupino.pt` | `admin1234` | CRM (TRIAL) |
| **SUPER_ADMIN** (Global) | `helderguiomar@gmail.com` | *via OTP* | Full Platform Admin |

---

## 📄 Documentation Index
All historical and architectural documentation is consolidated under [`docs/`](./docs/):
- [`docs/Architecture.md`](./docs/Architecture.md) — Core DI & Multi-Tenant architecture
- [`docs/Database.md`](./docs/Database.md) — Schema models & tenant isolation extension
- [`docs/Security.md`](./docs/Security.md) — JWT, RBAC & security audit records
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Deployment & SMTP setup guide
