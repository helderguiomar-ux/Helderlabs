# 🏛️ HELDERLABS ERP — Guia de Infraestrutura & Produção (PRODUCTION.md)

Este documento descreve a infraestrutura de produção, o modelo de alojamento Vercel, a base de dados PostgreSQL Cloud, a integração de Email Resend, procedimentos de backup, rollback e plano de recuperação de desastres (Disaster Recovery).

---

## 📐 1. ARQUITETURA DE PRODUÇÃO

```
[ Cliente / Browser ]
        │
        ├──────────────────────► Vercel Static Edge (HTML/CSS/JS estáticos em /public)
        │
        └─ ( /api/* ) ────────► Vercel Serverless Functions (api/index.ts -> Fastify ready)
                                        │
                                        ├──────► Resend REST API (Envio de Emails OTP)
                                        │
                                        └──────► PostgreSQL Cloud (Neon / Render Managed DB / Supabase)
```

- **Alojamento Frontend + Backend**: Vercel (`helderlabs.eu`).
- **Base de Dados**: PostgreSQL Gerido na Cloud (Neon, Render DB ou Supabase) com suporte a SSL (`sslmode=require`).
- **Email Service**: Resend API (`https://api.resend.com/emails`).
- **Monitorização em Tempo Real**: Socket.io (quando executado em modo standalone) / Webhooks.

---

## 🔑 2. VARIÁVEIS DE AMBIENTE DE PRODUÇÃO (VERCEL DASHBOARD)

Aceda a **Vercel Dashboard** ➔ **helderlabs-erp** ➔ **Settings** ➔ **Environment Variables**:

| Variável | Descrição | Exemplo / Placeholder |
|---|---|---|
| `DATABASE_URL` | String de conexão PostgreSQL Cloud (SSL obrigatório) | `postgresql://user:pass@ep-cool-site-1234.eu-central-1.aws.neon.tech/helderlabs_erp?sslmode=require` |
| `JWT_SECRET` | Chave de 32+ caracteres para assinar tokens JWT | `<JWT_PRODUCTION_SECRET_KEY>` |
| `JWT_EXPIRES_IN` | Validade dos tokens JWT de sessão | `8h` |
| `ALLOWED_ORIGINS` | Domínios autorizados pelo CORS (CSV) | `https://helderlabs.eu,https://www.helderlabs.eu` |
| `DEFAULT_SUPER_ADMIN_EMAIL` | Email do Super Administrador com acesso total | `helderguiomar@gmail.com` |
| `RESEND_API_KEY` | Chave de API do serviço Resend | `<RESEND_API_KEY>` |
| `SMTP_FROM` | Remetente visível nos emails de verificação | `HelderLabs ERP <noreply@helderlabs.eu>` |
| `NODE_ENV` | Ambiente de execução | `production` |
| `ENVIRONMENT` | Identificador de ambiente | `PRODUCTION` |
| `VERSION` | Versão ativa da aplicação | `1.0.0-consolidada` |

---

## 🔄 3. PROCEDIMENTO DE MIGRAÇÕES E DEPLOYMENT

### Migrações Seguras em Produção
O comando de build em `vercel.json` está configurado para:
```bash
cd backend && npm install && npx prisma generate && npm run build
```

Para aplicar migrações na base de dados de produção sem perder dados:
```bash
cd backend
npx prisma migrate deploy
```
> [!CAUTION]
> NUNCA executar `prisma migrate reset` ou `prisma db push --force-reset` em bases de dados de produção.

---

## 🛟 4. PLANO DE BACKUP & DISASTER RECOVERY

### Dump de Segurança da Base de Dados
Recomenda-se a realização periódica de backups automáticos ou manuais:
```bash
pg_dump "<POSTGRESQL_CLOUD_CONNECTION_STRING>" -F c -b -v -f helderlabs_erp_backup.dump
```

### Procedimento de Restauro
```bash
pg_restore -d "<POSTGRESQL_CLOUD_CONNECTION_STRING>" -v helderlabs_erp_backup.dump
```

---

## ↩️ 5. PROCEDIMENTO DE ROLLBACK

Se um novo deployment na Vercel apresentar comportamentos inesperados:

1. Aceda a **Vercel Dashboard** ➔ **helderlabs-erp** ➔ **Deployments**.
2. Localize o deployment anterior que estava 100% funcional.
3. Clique nos 3 pontos (`...`) ➔ **Instant Rollback**.
4. A Vercel re-aponta a rota `https://helderlabs.eu` imediatamente para o deployment anterior sem downtime.
