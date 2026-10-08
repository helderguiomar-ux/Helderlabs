# Entrega v1.6.0 — Envio de email configurável por tenant

> Autor: `[claude]` · 2026-10-08 · Base: commit `244aee0` (igual à pasta local, verificado ficheiro a ficheiro)

## O que foi feito

Cada empresa (tenant) passa a escolher, dentro do ERP, de onde saem os seus emails:

| Modo | De onde sai | Anexos | Configuração |
|:--|:--|:--|:--|
| **Remetente da plataforma** (omissão) | `HelderLabs ERP <noreply@helderlabs.eu>` via Resend, com "Responder para" da empresa | Não | Nenhuma |
| **O meu email (SMTP)** | Endereço da empresa (Gmail com password de aplicação, ou qualquer servidor SMTP) | Sim | Servidor, utilizador, password |

Ecrã: `app.html` → separador **Email** (só aparece para `TENANT_OWNER`, `TENANT_ADMIN`, `SUPER_ADMIN`, `PLATFORM_ADMIN`; o backend volta a validar).

## Ficheiros

| Ficheiro | Alteração |
|:--|:--|
| `backend/prisma/schema.prisma` | Modelos `TenantEmailSettings`, `EmailSendLog`, enum `EmailProvider`; relações no `Tenant` |
| `backend/prisma/migrations/20261008120000_tenant_email_settings/migration.sql` | **Nova**. Só `CREATE` (aditiva), idempotente, com RLS |
| `backend/src/modules/mail/services/credentialCipher.ts` | **Novo**. AES-256-GCM |
| `backend/src/modules/mail/services/smtpHostGuard.ts` | **Novo**. Guarda contra SMTP interno (SSRF) |
| `backend/src/modules/mail/services/TenantMailService.ts` | **Novo**. Gravar, ler, testar e enviar |
| `backend/src/modules/mail/routes/mail.routes.ts` | **Novo**. `/api/tenant/email/*` |
| `backend/src/app.ts` | Regista as rotas; erros 429 de negócio mantêm a mensagem própria |
| `backend/src/database/prisma/tenantScopedClient.ts` | Novos modelos no isolamento por tenant |
| `backend/public/app.html` | Separador e painel Email |
| `backend/public/assets/js/email-settings.js` | **Novo** |
| `backend/public/assets/css/email-settings.css` | **Novo** |
| `backend/tests/mail/*` | **Novo**. 27 testes |
| `backend/package.json` / `package-lock.json` | `nodemailer` 10.0.10; `smtp-server` 3.19.13 (só testes) |
| `backend/.env.example` | `EMAIL_CREDENTIALS_KEY` |
| `CHANGELOG.md` | Entrada v1.6.0 |

## API

| Método | Rota | Quem |
|:--|:--|:--|
| GET | `/api/tenant/email/status` | Qualquer utilizador autenticado |
| GET | `/api/tenant/email/settings` | Administrador do tenant |
| PUT | `/api/tenant/email/settings` | Administrador do tenant (10/min) |
| POST | `/api/tenant/email/test` | Administrador do tenant (5/min) — envia para o email do próprio |
| GET | `/api/tenant/email/logs?limit=` | Administrador do tenant |

Para os módulos: `new TenantMailService(tenantId, request.db).send({ to, subject, html, text?, attachments?, context, relatedType, relatedId }, actor)`.

## Segurança

- Password SMTP cifrada com AES-256-GCM; o `tenantId` entra como dados autenticados (copiar a linha para outro tenant torna-a ilegível). Nunca devolvida ao cliente, nunca na auditoria, campo `password` excluído da preservação de formulários do `connection-banner.js`.
- Mudar servidor, porta ou utilizador exige reintroduzir a password: impede que um administrador redirecione a password guardada para um servidor seu.
- Host SMTP resolvido no backend; recusados endereços privados, loopback, link-local e metadados da cloud; ligação feita ao IP resolvido com o nome original no TLS. Portas permitidas: 25, 465, 587, 2525.
- STARTTLS obrigatório fora da 465; TLS 1.2 mínimo; certificado validado.
- Nome do remetente e assunto sem quebras de linha (injeção de cabeçalhos); campos desconhecidos recusados (`.strict()`).
- Limite diário por tenant (omissão 300, máx. 2000), contado nas últimas 24 h.
- Alteração de definições auditada em categoria `SECURITY`, com estado anterior e novo (sem password).

## Verificação feita

- `tsc --noEmit`: sem erros. ESLint nos ficheiros novos: sem erros.
- 27/27 testes novos a passar, incluindo um teste de protocolo SMTP real com STARTTLS e autenticação.
- Suite completa: 233 testes, 139 passam; as 33 falhas são exatamente as mesmas de antes (testes que precisam de PostgreSQL + motor Prisma, indisponíveis nesta sandbox). Nenhuma regressão.
- Migração aplicada a um PostgreSQL 16 real, duas vezes (idempotente).
- QA no browser (Chromium): gravação, erro de password, teste com sucesso contra servidor SMTP com TLS validado, telemóvel 375 px e tema escuro.

**Não verificado aqui:** envio real para o Gmail (a sandbox não tem acesso à internet para SMTP) e a suite de integração com base de dados. Correr localmente antes do deploy.

## Passos para pôr em produção

1. **Gerar a chave (uma vez por ambiente)**
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. **Local:** acrescentar `EMAIL_CREDENTIALS_KEY=...` ao `backend/.env`.
3. **Produção:** Vercel → projeto `helderlabs-erp` → Settings → Environment Variables → `EMAIL_CREDENTIALS_KEY` (Production), com uma chave **diferente** da local. Guardar uma cópia num gestor de passwords: se se perder, cada empresa tem de reintroduzir a password SMTP.
4. **Local:** `cd backend` → `npm install` → `npm run db:migrate` (aplica a migração na base local) → `npm run verify`.
5. Testar em `http://localhost:3333/app.html#email-settings` com o Gmail real (password de aplicação).
6. Commit + push para `master`; a Vercel aplica a migração com `prisma migrate deploy`.
7. Em produção: separador Email → configurar → **Enviar email de teste**.

## Problemas encontrados fora do âmbito (não corrigidos)

1. **Cache de 1 ano nos assets.** `vercel.json` serve `/assets/*` com `max-age=31536000, immutable` e os `<script src="/assets/js/crm.js">` não têm versão. Um browser que já visitou o site continua a usar o `crm.js`, `finance.js`, etc. antigos depois de um deploy. É uma causa provável de "o que está online diverge do código". Os ficheiros novos desta entrega usam `?v=1.6.0`; os antigos precisam do mesmo tratamento.
2. **`connection-banner.js`**: `isCheckingHealth` nunca é declarada → `ReferenceError` em todas as páginas; a verificação de ligação não funciona. Correção de uma linha: `let isCheckingHealth = false;`.
3. **Migrações incompletas**: aplicadas por ordem numa base vazia, `20260912200000`, `20260913160000` e `20260913214500` falham porque as tabelas `hccall_products`, `hccall_dynamizations` e `hccall_objectives` nunca são criadas por nenhuma migração. Hoje não é possível reconstruir a base de dados só a partir do histórico (afeta recuperação de desastre e ambientes novos).
4. **`backend/.gitignore`** tem `.env*`, o que exclui também o `.env.example` do Git — não está no GitHub.
5. **`app.html` não é responsivo**: em telemóvel a barra de navegação estica a página para cerca de 1050 px.
6. **Contraste dos badges em tema escuro**: `.badge-success` usa fundo claro fixo.
