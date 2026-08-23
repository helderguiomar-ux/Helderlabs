# CLAUDE.md — Guia do Agente IA para HelderLabs ERP

Este ficheiro contém as regras, arquitetura e instruções completas para qualquer agente IA (Claude, Antigravity, GitHub Copilot) ou desenvolvedor trabalhar com segurança neste projeto.

> **VERSÃO CANÓNICA OFICIAL: v0.1.0**
> **Diretoria Única Canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Base de Dados Principal:** Neon Cloud PostgreSQL (Online)

---

## 🏛️ 1. ARQUITETURA DO PROJETO

- **Framework Backend**: Node.js + Fastify 4 + TypeScript (Strict Mode)
- **ORM & BD**: Prisma ORM v5 com PostgreSQL (Multi-tenant via Client Extension `tenantScopedClient.ts`)
- **Frontend**: SPA Estático em HTML5/CSS3/Vanilla JS (ES2023) servido por `@fastify/static` em `/public` e desacoplado para Vercel Static Hosting.
- **Serverless Adapter**: `api/index.ts` (raiz) compõe a app Fastify sem escutar portas, emitindo eventos `request` nativos para a Vercel.
- **Standalone Mode**: `backend/src/server.ts` escuta em `PORT` (3333) para dev local, Docker ou Render.com.

---

## 📁 2. ESTRUTURA DE PASTAS CRÍTICAS

```
helderlabs-erp/
├── api/
│   └── index.ts                 ← Adapter Serverless Vercel (NÃO REMOVER)
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
│   │   │   └── authenticate.ts  ← Fastify plugin de JWT e injeção request.db
│   │   └── modules/
│   │       ├── auth/            ← Autenticação (OTP, Passwords, OAuth, Resend)
│   │       ├── crm/             ← Leads, Oportunidades, Clientes, Métricas
│   │       ├── condominios/     ← Edifícios, Frações, Proprietários, Quotas
│   │       └── platform/        ← Super Admin, Gestão de Tenants e Módulos como Apps
│   ├── public/                  ← Frontend estático
│   │   ├── index.html           ← Landing page institucional (Dev banner condicional)
│   │   ├── login.html           ← Ecrã de Login (Check Email, OTP, Set Password)
│   │   ├── app.html             ← Dashboard principal do ERP
│   │   └── super-admin.html     ← Painel de controlo Super Admin (Gestão & Módulos)
│   ├── prisma/
│   │   ├── schema.prisma        ← Schema unificado PostgreSQL
│   │   ├── seed.ts              ← População de dados fictícios para dev
│   │   └── migrations/          ← Histórico de migrações SQL
│   └── tests/                   ← Testes automatizados (Node Test Runner nativo)
├── docs/                        ← Documentação histórica e técnica detalhada
│   └── PRODUCTION.md            ← Guia de Infraestrutura e Disaster Recovery
├── vercel.json                  ← Configuração de build, rewrites e serverless na Vercel
├── firebase.json                ← Configuração alternativa para Firebase Hosting
├── README.md                    ← Documentação principal do repositório
└── CLAUDE.md                    ← Este ficheiro de instruções para agentes IA
```

---

## 💻 3. COMANDOS IMPORTANTES

### Desenvolvimento Local
```bash
cd backend
npm install
npx prisma generate
npx prisma db push        # Sincroniza schema localmente
npm run seed              # Cria tenants e dados de teste
npm run dev               # Arranka servidor local em http://localhost:3333
```

### Validação e Testes
```bash
cd backend
npm run typecheck         # Verificação estrita de TypeScript (tsc --noEmit)
npm test                  # Executa os 32 testes unitários automatizados
```

### Build e Deploy
```bash
cd backend
npm run build             # Compila TypeScript para dist/
cd ..
npx vercel --prod --yes   # Publica diretamente em produção na Vercel
```

---

## 🔑 4. AUTENTICAÇÃO, RESEND E SUPER ADMIN

### Fluxo de Autenticação
1. **Passo 1 (`POST /api/auth/check-email`)**: Verifica se o utilizador já tem password definida na BD.
2. **Passo 2a (`POST /api/auth/send-otp`)**: Gera um código de 6 dígitos e envia via API do **Resend** (se `RESEND_API_KEY` estiver definida). Em ambiente local/dev, o código `123456` funciona sempre como código mestre.
3. **Passo 3a (`POST /api/auth/verify-otp`)**: Valida o código.
   - Se a conta for nova ou não aprovada: devolve `status: 'PENDING_APPROVAL'`.
   - Se for aprovada: gera JWT Token (`8h`).
4. **Passo 4 (`POST /api/auth/set-password`)**: Permite definir password cifrada com `bcrypt` (10 rounds) e guardada na BD.
5. **Passo 2b (`POST /api/auth/login`)**: Autenticação direta com email + password.

### Super Admin (`helderguiomar@gmail.com`)
- O email `helderguiomar@gmail.com` é auto-promovido pelo backend para `role: 'SUPER_ADMIN'` no Tenant de Sistema `helderlabs-platform`.
- O Super Admin é o **único** com permissão para:
  - Aceder a `/super-admin.html`.
  - Aprovar novos utilizadores no estado `PENDING_APPROVAL`.
  - Atribuir utilizadores a empresas (Tenants).
  - Ativar/desativar módulos (`ApplicationInstance`) por tenant e atribuir permissões (`ApplicationAssignment`).

---

## 🛡️ 5. REGRAS ABSOLUTAS PARA AGENTES IA

1. **NÃO DESTRUIR DADOS**: Nunca executar `npx prisma migrate reset` ou `npx prisma db push --force-reset` em bases de dados de produção.
2. **ISOLAMENTO MULTI-TENANT**: Todos os novos models com relação com `Tenant` DEVEM ser registados na lista de modelos tenant-scoped em `backend/src/database/prisma/tenantScopedClient.ts`.
3. **NUNCA GUARDAR SECRETS NO GIT**: Ficheiros `.env`, `.env.local` e chaves reais devem estar sempre no `.gitignore`. Usar apenas placeholders no `README.md` e `.env.example`.
4. **ERROR BOUNDARY**: Manter o `setErrorHandler` unificado em `backend/src/app.ts`. Validações Zod DEVEM retornar `400 Bad Request` com a lista de `issues`, e falhas de BD DEVEM retornar `503 Service Unavailable`.
5. **RETROCOMPATIBILIDADE**: A Landing Page (`index.html`), o Login (`login.html`), o ERP (`app.html`) e o Super Admin (`super-admin.html`) não devem ter funcionalidades ou estilos eliminados sem pedido explícito.
