# 🚀 HELDERLABS ERP — Unified Enterprise Repository
**Version:** 1.0.0-consolidada | **Architecture:** Multi-Tenant Modular B2B SaaS

Official consolidated repository for **HELDERLABS ERP**. Designed for seamless collaboration between **Claude**, **Antigravity**, **GitHub CI/CD**, and human developers.

---

## 🏗️ Architecture Overview

The system is built on a **Modular Fastify + TypeScript** core with **Prisma ORM (PostgreSQL)**, supporting both standalone Node.js execution (local/Docker/Render) and Serverless deployment (Vercel / Firebase).

```
helderlabs-erp/
├── api/                       ← Vercel Serverless Function entrypoint (api/index.ts)
├── backend/                   ← Fastify / Node.js / Prisma Backend
│   ├── src/                   ← Backend source code
│   │   ├── app.ts             ← Fastify application builder & global error boundary
│   │   ├── server.ts          ← Standalone HTTP server (local/Docker/Render)
│   │   ├── database/          ← Prisma Client & tenant isolation extension
│   │   └── modules/           ← CRM, Condomínios, Platform, Auth, etc.
│   ├── public/                ← Integrated static SPA frontend
│   │   ├── index.html         ← Landing page (conditional dev banner)
│   │   ├── login.html         ← Auth page (Email + OTP + Set Password)
│   │   ├── app.html           ← Main ERP Dashboard
│   │   └── super-admin.html   ← Platform Super Admin (Modules & Tenant App Management)
│   ├── prisma/
│   │   ├── schema.prisma      ← Unified Prisma Schema (+ Condomínios, + Applications)
│   │   ├── seed.ts            ← Mock data seeder (3 tenants, 7 users, 4 active apps)
│   │   └── migrations/        ← Prisma SQL migrations history
│   └── tests/                 ← 32 automated unit & integration tests
├── docs/                      ← Complete historical & architectural documentation
│   └── PRODUCTION.md          ← Infrastructure & Disaster Recovery guide
├── CLAUDE.md                  ← AI Agent instructions & operating rules
├── CHANGELOG.md               ← Version history & changelog
├── vercel.json                ← Vercel Serverless & Static Asset routing configuration
├── firebase.json              ← Firebase Hosting & Cloud Functions configuration
└── package.json               ← Root scripts & project orchestration
```

---

## 🛠️ Quick Start — Local Development

### 1. Installation
```bash
cd backend
npm install
npx prisma generate
```

### 2. Environment Configuration
Create `backend/.env` (or `.env.local`):
```env
DATABASE_URL="postgresql://postgres:enterprise_password_2026@localhost:5432/helderlabs_erp"
PORT=3333
NODE_ENV=development
ENVIRONMENT=DEVELOPMENT
VERSION=1.0.0-consolidada
JWT_SECRET="dev_secret_key_change_in_production"
ALLOWED_ORIGINS="http://localhost:3333,http://localhost:3000,http://127.0.0.1:3333"
DEFAULT_SUPER_ADMIN_EMAIL="helderguiomar@gmail.com"
```

### 3. Database Sync & Seed
```bash
cd backend
npx prisma db push        # Sync schema to local database
npm run seed              # Seed mock tenants, users, and module applications
```

### 4. Start Server
```bash
cd backend
npm run dev
```

Local endpoints:
- **Landing Page**: [http://localhost:3333](http://localhost:3333)
- **Login**: [http://localhost:3333/login.html](http://localhost:3333/login.html)
- **ERP Dashboard**: [http://localhost:3333/app.html](http://localhost:3333/app.html)
- **Super Admin**: [http://localhost:3333/super-admin.html](http://localhost:3333/super-admin.html)
- **Health Check**: [http://localhost:3333/api/health](http://localhost:3333/api/health)

---

## 🌐 Production Deployment

### 1. Architecture
- **Hosting Platform**: Vercel (`https://helderlabs.eu`)
- **Database**: PostgreSQL Cloud (Neon / Render Managed DB / Supabase)
- **ORM**: Prisma 5 with strict multi-tenant client extensions
- **Email Dispatcher**: Resend API (`https://api.resend.com/emails`)

### 2. Required Environment Variables (Vercel Dashboard)
In **Vercel Dashboard** ➔ **helderlabs-erp** ➔ **Settings** ➔ **Environment Variables**:

```env
DATABASE_URL=<POSTGRESQL_CLOUD_CONNECTION_STRING>
JWT_SECRET=<JWT_PRODUCTION_SECRET_KEY>
JWT_EXPIRES_IN=8h
ALLOWED_ORIGINS=https://helderlabs.eu,https://www.helderlabs.eu
DEFAULT_SUPER_ADMIN_EMAIL=helderguiomar@gmail.com
RESEND_API_KEY=<RESEND_API_KEY>
SMTP_FROM=HelderLabs ERP <noreply@helderlabs.eu>
NODE_ENV=production
ENVIRONMENT=PRODUCTION
VERSION=1.0.0-consolidada
```

### 3. Migrations & Deployment Procedure
1. Apply Prisma migrations to the production cloud database:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```
2. Trigger Vercel Production deployment:
   ```bash
   npx vercel --prod --yes
   ```

### 4. Authentication & Approval Flow
- **Super Admin**: `helderguiomar@gmail.com` is auto-provisioned as `SUPER_ADMIN` in the system tenant with full access to `/super-admin.html`.
- **New Users**: Registrations and OTP verifications place accounts in `PENDING_APPROVAL` status until approved and assigned to a Tenant by `helderguiomar@gmail.com`.
- **Passwords**: Hashed with `bcrypt` (10 salt rounds) and stored securely in PostgreSQL.

### 5. Troubleshooting & Recovery
- **`DATABASE_UNAVAILABLE` (503)**: Triggered when `DATABASE_URL` is unconfigured or unreachable. Verify PostgreSQL Cloud string in Vercel settings.
- **Rollback**: In Vercel Dashboard, select the previous working deployment and click **Instant Rollback**.
- **Database Backup**: Run `pg_dump "<POSTGRESQL_CLOUD_CONNECTION_STRING>" -F c -b -v -f backup.dump`.

---

## 🧪 Automated Testing

```bash
cd backend
npm run typecheck         # TypeScript strict compilation check
npm test                  # Run 32 automated unit tests
```

---

## 🔑 Demo Test Credentials (Dev / Local)

| Role / Tenant | Email | Password / OTP | Access |
|---|---|---|---|
| **SUPER_ADMIN** | `helderguiomar@gmail.com` | `123456` (dev code) | Full Platform Admin (`/super-admin.html`) |
| **TENANT_ADMIN** (Alfa) | `ana@consultoria-alfa.pt` | `admin1234` | CRM (ACTIVE), Finance (TRIAL) |
| **SALES** (Alfa) | `carlos@consultoria-alfa.pt` | `admin1234` | CRM (ACTIVE) |
| **TENANT_ADMIN** (Condo) | `luisa@administracondo.pt` | `admin1234` | Condomínios (ACTIVE) |
| **TENANT_OWNER** (StartUp) | `bea@startupino.pt` | `admin1234` | CRM (TRIAL) |
