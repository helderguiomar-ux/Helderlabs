# PROMPT ANTIGRAVITY — CRM HelderLabs: Parte A (publicar v1.6.0) + Parte B (CRM completo)

> **Este prompt tem duas partes, executadas por ordem.**
> - **Parte A — Verificar e publicar a v1.6.0 (email por tenant).** Código já escrito pelo Claude; tu só verificas e publicas.
> - **Parte B — Construir o CRM completo**, em fases B1 a B8. Aqui és o autor do código.
>
> A Parte B **só começa depois de a Parte A estar em produção e reportada**. Se a Parte A parar num STOP, a Parte B não começa.

---

# PARTE A — Verificar e publicar a v1.6.0

## Papel e limites

És o agente de verificação e deploy do HelderLabs ERP. O código desta entrega foi escrito pelo Claude e já está na pasta local. A tua tarefa é **verificar com evidência e publicar**. **Não és autor desta alteração e não reescreves o código.**

- **Fonte de verdade de trabalho:** `C:\Users\helde\Desktop\Dev\helderlabs-erp` (ramo `master`, alterações ainda por commitar)
- **Destino:** GitHub `helderguiomar-ux/Helderlabs`, ramo `master` → Vercel, projeto `helderlabs-erp` → `https://helderlabs.eu`
- **Descrição técnica completa:** `Claude outputs/ENTREGA_EMAIL_POR_TENANT_v1.6.0.md` (ler antes de começar)

Lê também `AGENTS.md` e `CLAUDE.md` e cumpre-os.

### Regras invioláveis da Parte A

1. **Âmbito fechado.** Só podes commitar os 18 ficheiros da lista abaixo. Não alteras nenhum outro ficheiro, nem para "melhorar" ou "corrigir de passagem". Os módulos Finanças, HCCALL, 2SELLMAIS, Condomínios, a autenticação e o super-admin ficam intactos.
2. **Não corriges o código desta entrega.** Se encontrares um erro num destes ficheiros, **paras**, descreves o erro com ficheiro, linha, comando e output, e não fazes deploy. A correção volta ao Claude.
3. **Problemas fora do âmbito são só reportados.** A secção "Problemas encontrados fora do âmbito" da entrega lista seis problemas conhecidos (cache de assets, `isCheckingHealth`, migrações incompletas, etc.). Não os corriges nesta tarefa.
4. **Sem evidência não há "passou".** Cada verificação no relatório leva o comando exato e as linhas relevantes do output real. Não escrevas "100% verde", "tudo conforme" ou "122/122" sem colar o output que o prova.
5. **Nunca imprimas segredos.** Não mostres nem escrevas em ficheiros commitados o valor de `EMAIL_CREDENTIALS_KEY`, `DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY` ou qualquer password.
6. **Base de dados de produção:** é proibido `prisma migrate reset`, `db push`, `DROP`, `TRUNCATE` ou `DELETE` em massa. A migração em produção aplica-se apenas pelo pipeline da Vercel (`prisma migrate deploy`).
7. **Pontos de paragem (STOP):** quando uma verificação marcada STOP falha, não avanças. Reportas e esperas pelo Hélder.

---

## Ficheiros da entrega (âmbito exato)

**Alterados**
```
CHANGELOG.md
backend/package.json
backend/package-lock.json
backend/prisma/schema.prisma
backend/public/app.html
backend/src/app.ts
backend/src/database/prisma/tenantScopedClient.ts
```

**Novos**
```
backend/prisma/migrations/20261008120000_tenant_email_settings/migration.sql
backend/public/assets/css/email-settings.css
backend/public/assets/js/email-settings.js
backend/src/modules/mail/services/credentialCipher.ts
backend/src/modules/mail/services/smtpHostGuard.ts
backend/src/modules/mail/services/TenantMailService.ts
backend/src/modules/mail/routes/mail.routes.ts
backend/tests/mail/TenantMailService.test.ts
backend/tests/mail/support/fakeMailDb.ts
Claude outputs/ENTREGA_EMAIL_POR_TENANT_v1.6.0.md
Claude outputs/PROMPT_ANTIGRAVITY_VERIFICAR_E_DEPLOY_v1.6.0_EMAIL.md
```

O ficheiro `backend/.env.example` também foi atualizado, mas **não vai para o Git** (o `backend/.gitignore` exclui-o). Não alteres o `.gitignore`.

---

> Os comandos assumem PowerShell no Windows (por isso `curl.exe` e não `curl`).

## A0 — Estado do repositório (STOP)

```powershell
cd C:\Users\helde\Desktop\Dev\helderlabs-erp
git fetch origin
git status --short
git log -1 --oneline
git rev-parse origin/master
```

Confirma:
- O HEAD local e `origin/master` estão no commit `244aee0`. Se `origin/master` tiver commits mais recentes, **STOP**: reporta quais são e não faças merge sozinho.
- `git status --short` mostra **apenas** os ficheiros da lista acima. Qualquer outro ficheiro modificado ou novo → **STOP** e lista-o.
- Nenhum ficheiro `.env*` aparece como modificado nem como novo e por seguir (`git status --short --ignored | findstr .env` só pode mostrar ignorados).

## A1 — Revisão de código (só leitura)

Lê os ficheiros novos e o diff dos alterados (`git diff`) e confirma, citando a linha:

1. `mail.routes.ts`: o `tenantId` vem só de `request.user.tenantId` e nunca do body nem da query. As rotas `settings`, `test` e `logs` exigem um papel de administrador e `status` exige apenas autenticação.
2. `TenantMailService.ts`: nenhuma resposta, log ou auditoria inclui `smtpPassword` nem `smtpPasswordEnc`. Usa `toPublicView`.
3. `credentialCipher.ts`: AES-256-GCM com IV aleatório de 12 bytes e o tenantId como AAD. Sem chave, devolve 503.
4. `smtpHostGuard.ts`: bloqueia redes privadas, loopback, link-local e 169.254.169.254, e liga ao IP resolvido.
5. `migration.sql`: só contém `CREATE TYPE`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, FKs `ON DELETE RESTRICT` e RLS. **Nenhum** `DROP` de tabela ou coluna nem `ALTER` destrutivo.
6. `schema.prisma`: o diff só acrescenta os modelos `TenantEmailSettings`, `EmailSendLog`, o enum `EmailProvider` e duas relações no `Tenant`. Não pode haver reformatação de outros modelos.
7. `app.html`: o separador Email nasce com `hidden` e o texto do servidor passa por `esc()` em `email-settings.js`.

Não alteras nada nesta fase. Se encontrares um problema → **STOP** e reporta (regra 2).

## A2 — Instalação e verificação local (STOP)

```powershell
cd backend
npm install
```

Gera uma chave **só para o ambiente local** e acrescenta-a ao `backend\.env` sem a imprimir no relatório:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Acrescenta a linha `EMAIL_CREDENTIALS_KEY=<valor gerado>` ao `backend\.env`.

Depois corre:

```powershell
npm run env:check
npx prisma generate
npm run typecheck
npx eslint src/modules/mail src/app.ts src/database/prisma/tenantScopedClient.ts
npx tsx --test tests/mail/TenantMailService.test.ts
```

Resultado esperado:
- `typecheck`: 0 erros.
- `eslint`: 0 erros.
- Testes de email: `# tests 27`, `# pass 27`, `# fail 0`.

Qualquer desvio → **STOP**.

### Base de dados local e suite completa

```powershell
npm run db:up            # se a BD local estiver em Docker
npm run db:migrate       # aplica 20261008120000_tenant_email_settings na BD LOCAL (passa pelo db:guard)
npm test
```

- Confirma no output do `db:migrate` que a migração `20261008120000_tenant_email_settings` foi aplicada.
- Na suite completa, compara as falhas com o estado **anterior** à entrega. Para isso, faz `git stash`, corre `npm test`, anota as falhas, faz `git stash pop` e volta a correr. **Qualquer teste que passava antes e falha depois → STOP.** As falhas que já existiam antes vão para o relatório, sem correção.

## A3 — Teste funcional local

```powershell
npm run dev
```

Em `http://localhost:3333/app.html#email-settings`, com sessão de um administrador do tenant HelderLabs:

1. O separador **Email** aparece. Com um utilizador sem papel de administrador, não aparece e `GET /api/tenant/email/settings` devolve 403.
2. Modo "Remetente da plataforma": grava sem erros e o estado mostra "Ativo".
3. Modo "O meu email (SMTP)" → Gmail → utilizador preenchido e password vazia → "Gravar": tem de mostrar "Indique a password SMTP."
4. Gmail com uma password **inventada** → Gravar → "Enviar email de teste": tem de mostrar a mensagem sobre a password de aplicação. O estado fica "Por testar".
5. Na resposta de `GET /api/tenant/email/settings`, separador Network do DevTools, não aparece a password nem `smtpPasswordEnc`. Apenas `hasPassword: true`.
6. Na tabela `tenant_email_settings` da BD local, `smtpPasswordEnc` começa por `v1:` e não contém a password em claro.

Tira capturas de ecrã dos passos 1 a 4 para o relatório. **Não uses a password real do Gmail do Hélder.** O teste com o Gmail real é feito por ele depois do deploy.

Antes de avançar, deixa o tenant local em modo "Remetente da plataforma".

## A4 — Pré-requisito de produção (STOP)

A variável `EMAIL_CREDENTIALS_KEY` tem de existir na Vercel (Production) **antes** do deploy. Sem ela, o ecrã funciona em modo plataforma, mas não é possível guardar credenciais SMTP.

```powershell
npx vercel env ls production
```

- Confirma apenas que `EMAIL_CREDENTIALS_KEY` aparece na lista. Não leias nem imprimas o valor.
- Se não aparecer → **STOP** e pede ao Hélder que a crie (Vercel → helderlabs-erp → Settings → Environment Variables), com uma chave **diferente** da local e guardada no gestor de passwords dele. Não a cries tu.

## A5 — Commit e deploy

```powershell
cd C:\Users\helde\Desktop\Dev\helderlabs-erp
git add CHANGELOG.md backend/package.json backend/package-lock.json backend/prisma/schema.prisma backend/public/app.html backend/src/app.ts backend/src/database/prisma/tenantScopedClient.ts backend/prisma/migrations/20261008120000_tenant_email_settings/migration.sql backend/public/assets/css/email-settings.css backend/public/assets/js/email-settings.js backend/src/modules/mail backend/tests/mail "Claude outputs/ENTREGA_EMAIL_POR_TENANT_v1.6.0.md" "Claude outputs/PROMPT_ANTIGRAVITY_VERIFICAR_E_DEPLOY_v1.6.0_EMAIL.md"
git status --short
```

Confirma que só estão em stage os ficheiros da lista. Não uses `git add .` nem `git add -A`.

```powershell
git commit -m "feat(email): envio de email configuravel por tenant (v1.6.0)" -m "Definicoes de email por empresa (plataforma ou SMTP proprio), credenciais cifradas AES-256-GCM, guarda SSRF, limite diario, registo de envios, migracao aditiva com RLS e 27 testes."
git push origin master
```

Acompanha o build na Vercel até ao fim. No log do build, confirma e copia:
- `prisma migrate deploy` aplicou `20261008120000_tenant_email_settings`, ou indica que já estava aplicada.
- O build terminou com estado `Ready`.

Se o build falhar → **STOP**. Não faças novo push com correções: reporta o log. Produção continua no deploy anterior, e a migração é aditiva, por isso é segura para o código antigo.

## A6 — Verificação em produção

```powershell
curl.exe -s https://helderlabs.eu/api/health
curl.exe -s -o NUL -w "%{http_code}" https://helderlabs.eu/api/tenant/email/status
```

- `/api/health` responde OK.
- `/api/tenant/email/status` sem token responde **401**. Se responder 404, as rotas não foram publicadas → reporta.
- `https://helderlabs.eu/app.html` contém `email-settings.js?v=1.6.0` e `email-settings.css?v=1.6.0b` (ver o código-fonte da página).
- Com login de administrador: o separador Email aparece, o modo plataforma grava e "Enviar email de teste" entrega ao email do utilizador. Confirma a receção.
- Os módulos CRM, Finanças e HCCALL continuam a abrir (verificação rápida, sem testes de escrita).

### Rollback

Se alguma verificação de produção falhar de forma que afete utilizadores, faz Instant Rollback na Vercel para o deploy anterior e reporta. **Não reverts a migração**: as tabelas novas não afetam o código anterior.

## A7 — Relatório

Escreve `Claude outputs/RELATORIO_ANTIGRAVITY_DEPLOY_v1.6.0_EMAIL.md` com:

1. Commit publicado (hash) e URL do deploy na Vercel.
2. Para cada fase (A0 a A6): **PASSOU / FALHOU / NÃO EXECUTADO**, com o comando e o output real.
3. Falhas da suite que já existiam antes, com a comparação antes/depois.
4. Problemas encontrados nos ficheiros da entrega (ficheiro:linha), mesmo que pequenos.
5. Problemas fora do âmbito observados (apenas listados).
6. Capturas de ecrã das fases A3 e A6.
7. O que fica para o Hélder fazer: configurar o Gmail real com password de aplicação e enviar o email de teste.

Não commits o relatório. Fica na pasta local para o Claude e o Hélder lerem.

---
---

# PARTE B — Construir o CRM completo (B1 a B8)

## B.0 Papel, objetivo e regras

Nesta parte és o **autor** do código. O objetivo é um CRM B2B completo e fiável para PME, usado pelo próprio Hélder (HelderLabs) e vendido a outras empresas. Cobre empresas, contactos, entrada e importação de leads, pipeline, atividades e follow-ups, catálogo, propostas com aceitação online, conta corrente, email comercial com RGPD, painel e permissões.

Trabalha **uma fase de cada vez, pela ordem B1 → B8**. Cada fase é publicável sozinha. Não começas uma fase sem a anterior estar em produção e reportada.

### O que NÃO se faz (decisão do Hélder, definitiva)

- **Não se emitem faturas, recibos, notas de crédito nem qualquer documento fiscal.** O CRM não é software de faturação e não pode precisar de certificação da AT.
- Não há numeração fiscal, SAF-T, ATCUD, QR code fiscal, hash de faturas nem comunicação à AT.
- A **conta corrente apenas regista** documentos emitidos no software de faturação certificado do cliente (com o número desse documento) e os pagamentos recebidos.
- As propostas levam sempre a frase: **"Este documento não é uma fatura."**
- Se alguma tarefa te levar a emitir um documento fiscal, paras e reportas.

### Âmbito de ficheiros

**Podes alterar:**
- `backend/src/modules/crm/**`, onde podes criar subpastas.
- `backend/public/assets/js/crm/**`: divide o atual `crm.js` em ficheiros por área.
- `backend/public/assets/css/crm.css`, ficheiro novo.
- O painel CRM dentro de `backend/public/app.html` (`#panel-crm` e os modais do CRM) e as respetivas tags `<script>`/`<link>`.
- `backend/prisma/schema.prisma`, **apenas** modelos e enums do CRM, de forma aditiva.
- Migrações novas em `backend/prisma/migrations/`.
- `backend/src/database/prisma/tenantScopedClient.ts`, só para registar os modelos novos.
- `backend/src/app.ts`, só para registar rotas novas do CRM, incluindo as públicas de aceitação e de cancelamento de subscrição.
- `backend/src/routes/public.routes.ts`, **só** o handler `POST /api/public/leads` (fase B2).
- `backend/tests/crm/**`, `backend/package.json` e `package-lock.json` (só as dependências indicadas).
- `CHANGELOG.md`, `ESTADO.md`, `DECISOES.md`, `DIARIO.md`.

**Podes usar sem alterar:** `TenantMailService` (`backend/src/modules/mail/`), `AuditService`, `EntitlementService`, `authenticate`/`requireApp`/`requirePermission`, `TenantBranding`, `TenantCompanyProfile`.

**Não tocas:** os módulos financas, hccall, sellmais, condominios, auth e platform (exceto uso), `mail/`, o design system (`design-system/*.css`), `super-admin.html`, `workspace.html`, `index.html` e `login.html`.

### Regras técnicas obrigatórias

1. **Tenant só da sessão:** `request.user.tenantId`. Nunca do body, da query ou dos params.
2. **Posse verificada:** qualquer operação sobre um registo filho (contacto, morada, documento, relação, contrato, atividade, linha, lançamento) confirma primeiro que o registo pai pertence ao tenant e não está apagado. Um id de outro tenant devolve **404**, nunca 403, para não revelar que o registo existe.
3. **Migrações apenas aditivas:** `CREATE`, `ADD COLUMN` com default ou nullable, `CREATE INDEX`. **Proibido** `DROP`/`RENAME` de tabelas ou colunas e alterar o tipo de colunas existentes. As tabelas antigas (`leads`, `opportunities`, `customers`, `contacts`, `communications`) **ficam**: deixam de ser escritas e são marcadas como obsoletas num comentário no schema. Todas as tabelas novas levam RLS, com o padrão de `20261008120000_tenant_email_settings`.
4. **Dinheiro em cêntimos inteiros** (`Int`, ou `BigInt` para agregados). Nunca `Float`. Arredondamento *half-up* ao cêntimo, por linha.
5. **Nada se apaga:** usa `deletedAt`. Lançamentos de conta corrente e versões de propostas enviadas são **imutáveis**, com um trigger na base de dados que bloqueia UPDATE/DELETE, como em `audit_logs`.
6. **Auditoria:** cada evento de negócio (criar, alterar, arquivar, mudar de fase, enviar proposta, aceitar, registar pagamento, estornar, importar, anular importação) chama `AuditService.audit` com `oldValue`/`newValue`, para além do hook genérico.
7. **Validação com Zod `.strict()`** em todas as rotas. Emails com `.email()`. NIF português validado pelo dígito de controlo (módulo 11) quando o país for Portugal. Telefones normalizados para E.164, com `+351` por omissão.
8. **Segurança no front-end:** nenhum texto vindo do servidor entra em `innerHTML` sem passar por `esc()`. Cria `crm/crm-core.js` com `esc()` e usa-o em todos os ficheiros. Os handlers `onclick` com ids interpolados passam a usar `data-id` e delegação de eventos.
9. **Listas paginadas:** `limit` ≤ 100, cursor ou página, pesquisa e filtros feitos no servidor. Métricas com `groupBy`/`aggregate`/SQL, **nunca** carregando todas as linhas para memória.
10. **Permissões:** as rotas usam `requireApp('crm')` mais `requirePermission(...)` com o catálogo da fase B8. Até à B8, `requireApp('crm')` chega.
11. **Interface:** português de Portugal, sem emojis, ícones SVG inline, tokens do design system, tema claro e escuro, utilizável a 375 px (sem scroll horizontal no painel CRM). Estados vazios, de carregamento e de erro desenhados em todas as listas.
12. **Cache:** todos os `<script>`/`<link>` do CRM em `app.html` levam `?v=<versão>`, porque a Vercel serve `/assets/*` com cache de 1 ano. Sobe a versão sempre que um ficheiro do CRM mudar.
13. **Dependências permitidas:** `pdf-lib` (PDF no servidor), `papaparse` (CSV) e `exceljs` (XLSX). Usa uma versão publicada há pelo menos 2 semanas e fixa a versão exata. Não uses `xlsx`/SheetJS do npm (versão desatualizada e com vulnerabilidades conhecidas), nem Puppeteer/Chromium no servidor. A CSP só permite scripts do próprio domínio, por isso nada de CDNs no front-end.
14. **Dúvidas de especificação:** escolhe a opção mais simples que cumpra o objetivo, regista-a em `DECISOES.md` e segue. Não inventes funcionalidades fora desta especificação.
15. **Sem evidência não há "passou"** (regra 4 da Parte A), em todas as fases.

### Ciclo obrigatório em cada fase

1. **Compreensão:** lê o código atual da área e escreve `Claude outputs/CRM_B<n>_PLANO.md` com os modelos, as rotas, os ficheiros afetados, a migração e os riscos.
2. **Implementação.**
3. **Testes automáticos:** os listados na fase, mais os de regressão do CRM. Tudo verde, com o output colado.
4. **Verificação local:** `npm run typecheck`, `npx eslint src/modules/crm`, `npm test`, comparando as falhas com a baseline da A2. Nenhum teste que passava pode passar a falhar.
5. **QA visual com Playwright:** capturas em desktop (1360 px), telemóvel (375 px) e tema escuro de cada ecrã novo ou alterado. Verifica que não há erros na consola nem scroll horizontal.
6. **Commit único da fase** com `git add` explícito dos ficheiros (nunca `git add .`). Mensagem `feat(crm): B<n> — <título>`.
7. **Deploy** com push para `master` e build `Ready`, seguido de verificação em produção (smoke tests da fase).
8. **Relatório** em `Claude outputs/RELATORIO_ANTIGRAVITY_CRM_B<n>.md`, com o mesmo formato da A7.

Se qualquer passo falhar → **STOP** nessa fase.

---

## B1 — Fundações e segurança (obrigatória antes de tudo)

Corrige os defeitos já identificados no CRM atual. Sem isto, não se acrescentam funcionalidades.

1. **Isolamento entre tenants:** `updateCompanyContact`, `deleteCompanyContact`, `deleteCompanyAddress`, `deleteCompanyDocument`, `deleteCompanyRelation`, `addCompanyContact`, `addCompanyAddress`, `addCompanyDocument`, `addCompanyRelation` (as duas empresas), `createContract`/`updateContract`/`deleteContract` e `convertLeadToOpportunity`/`winOpportunity` passam a verificar a posse através de um helper `assertCompanyOwned(companyId)` e `assertChildOwned(...)`. Hoje operam só pelo id, e qualquer tenant consegue alterar registos de outro.
2. **XSS:** reescreve `crm.js` (dividido em `crm/crm-core.js`, `crm/crm-companies.js`, …) com `esc()` em toda a interpolação.
3. **Apagar = arquivar:** `deleteLead` passa a soft delete. `CompanyRelation` ganha `deletedAt` (aditivo) e deixa de usar `delete`.
4. **Campo perdido:** `decisionPower` é aceite pela rota e descartado em silêncio. Acrescenta a coluna a `CompanyContact` (enum `DECISOR`, `INFLUENCIADOR`, `UTILIZADOR`, `OUTRO`; nullable) e grava-a.
5. **Paginação e pesquisa no servidor** em `GET /companies` (`limit`, `cursor`, `search`, `status`, `sector`, `ownerUserId`). O painel passa a usar `groupBy` em vez de ler todas as linhas.
6. **Validação:** NIF com dígito de controlo, email e telefone (regra 7).
7. **Duplicados:** ao criar uma empresa com um NIF ou email já existente no tenant, devolve **409** com o id existente. O ecrã oferece "Abrir existente" e "Criar mesmo assim" (`force: true`, auditado).
8. **Cache:** `?v=` nos assets do CRM (regra 12).

**Testes mínimos:** para cada rota de filho, um pedido com id de outro tenant devolve 404 e não altera nada. Também: NIF válido e inválido, duplicado → 409, `force` cria, paginação devolve `nextCursor`, `esc()` neutraliza `<img src=x onerror=alert(1)>` num nome de empresa (teste no browser: nenhum alert, texto literal visível).

---

## B2 — Modelo único e entrada de leads

**Decisão de modelo:** a **Empresa (`Company`) é a entidade única** do CRM. Um particular é uma Company com `entityType = 'PARTICULAR'`. O ciclo de relação está em `status` (`POTENTIAL`/`LEAD`/`CUSTOMER`/`EX_CUSTOMER`/`SUPPLIER`/`PARTNER`). As pessoas são `CompanyContact`. `Lead`/`Customer`/`Contact` ficam obsoletos.

### Campos RGPD (aditivos)
Em `Company` e `CompanyContact`:
- `legalBasis` (enum `CONSENT`, `LEGITIMATE_INTEREST`, `CONTRACT`, `UNKNOWN`; omissão `UNKNOWN`)
- `consentAt`
- `consentSource`
- em `CompanyContact`, também `emailOptOut` (boolean, omissão false) e `optOutAt`.

### Migração dos dados antigos (SQL, idempotente, dentro da migração)
- Para cada `leads` com `companyId IS NULL` e `deletedAt IS NULL`: cria uma `crm_companies` (`tradeName` = `company` ou `name`, `status` `LEAD`, `originSource` = `source`, `email`, `phone`) e um `crm_company_contacts` principal (`name`, `email`, `phone`/`mobile`, `role`). Depois atualiza `leads.companyId`.
- Para cada `customers` com `companyId IS NULL`: cria a Company com `status CUSTOMER`, copia os `contacts` e atualiza `customers.companyId`.
- Os ids são gerados com `gen_random_uuid()::text`.
- **Antes de produção:** corre `npm run db:mirror` (cópia anonimizada) e aplica a migração localmente. Reporta as contagens antes e depois (leads e customers migrados, companies e contacts criados) e corre a migração **duas vezes** para provar que a segunda não cria nada. → **STOP para aprovação do Hélder** com estas contagens, antes do deploy da B2.

### Entrada de leads
1. **Registo rápido** (modal mínimo): nome da pessoa, empresa (opcional → `PARTICULAR`), email, telefone, origem (lista configurável por tenant mais "outra"), base legal e nota. Cria Company `LEAD`, o contacto principal e uma tarefa "Primeiro contacto" para daqui a 24 h.
2. **Formulário do site** (`POST /api/public/leads`): passa a criar Company, contacto, atividade "Pedido recebido pelo site" com a mensagem e tarefa de follow-up para 24 h, no tenant da plataforma. Mantém o rate limit e acrescenta um campo isco (*honeypot*) escondido: se vier preenchido, devolve 200 e descarta o pedido.
3. **Importação CSV/XLSX** (servidor; máx. 5 MB e 5000 linhas):
   - Upload → deteção de colunas com sugestão de mapeamento (nome, empresa, NIF, email, telefone, cargo, morada, cidade, código postal, setor, origem, notas, etiquetas) → **pré-visualização** com validação por linha (erros e duplicados por NIF, email ou telefone, dentro do ficheiro e contra a base de dados).
   - Estratégia para duplicados: ignorar, completar campos vazios ou criar novo.
   - Base legal e origem aplicadas ao lote.
   - Confirmação final.
   - Modelos `CrmImportBatch` (estado, ficheiro, contagens, estratégia, `createdBy`) e `CrmImportRow` (linha, dados, resultado, id criado ou atualizado, valores anteriores quando houve atualização).
   - **Anular importação** até 7 dias depois: arquiva o que foi criado e repõe os valores anteriores do que foi atualizado. Auditado.
   - Exportar as linhas com erro para CSV, para corrigir e voltar a importar.

**Testes mínimos:** a migração SQL é idempotente (teste contra Postgres). O registo rápido cria empresa, contacto e tarefa. Lead pelo site com honeypot preenchido não cria nada. Importação com NIF inválido, email duplicado e linhas vazias dá resultado por linha correto. As três estratégias de duplicados funcionam. Anular repõe o estado anterior. Um ficheiro com mais de 5000 linhas é recusado.

---

## B3 — Pipeline, atividades e follow-ups

### Modelos novos
- `CrmDeal`: `companyId` (obrigatório), `contactId?`, `title`, `stage` (enum `NEW`, `QUALIFIED`, `PROPOSAL`, `NEGOTIATION`, `WON`, `LOST`), `valueCents`, `probability` (0–100, com omissão por fase), `expectedCloseDate`, `ownerUserId`, `source`, `lostReason` (obrigatório ao passar a `LOST`), `wonAt`, `lostAt`, `deletedAt`.
- `CrmDealStageHistory` (imutável): `dealId`, `fromStage`, `toStage`, `changedAt`, `changedBy`.
- `CrmActivity`: `companyId`, `contactId?`, `dealId?`, `type` (`CALL`, `EMAIL`, `MEETING`, `NOTE`, `TASK`, `WHATSAPP`), `subject`, `body`, `direction` (`IN`/`OUT`/null), `dueAt?`, `completedAt?`, `ownerUserId`, `deletedAt`.
- Migração dos `opportunities` antigos para `CrmDeal` (`valueCents = round(estimatedValue*100)`), ligando à Company do lead ou do customer. Idempotente, com as mesmas regras e o mesmo STOP de contagens da B2.

### Funcionalidades
1. **Quadro do pipeline** (kanban por fase, com arrastar e largar e alternativa por menu em telemóvel) e **vista em lista**. Filtros por responsável, período e origem. Totais por fase (contagem, valor e valor ponderado).
2. **Ficha 360º** com uma **cronologia única**: atividades, mudanças de fase, emails enviados (`email_send_logs` com `relatedType`), propostas e lançamentos de conta corrente, por ordem cronológica.
3. **Tarefas e follow-ups:** vista **"Hoje"** com as tarefas em atraso e as de hoje, concluir com um clique e reagendar. Um negócio aberto sem tarefa futura aparece marcado **"Sem próximo passo"** no quadro e na vista Hoje.
4. Registo rápido de chamada, nota ou reunião a partir da ficha.

**Testes mínimos:** uma mudança de fase grava o histórico. Passar a `LOST` sem motivo devolve 400. Os totais do pipeline estão certos com valores em cêntimos. A deteção de "sem próximo passo" funciona. A cronologia ordena e mistura as fontes. Há isolamento por tenant em deals e atividades.

---

## B4 — Catálogo e propostas

### Modelos novos
- `CrmProduct`: `code`, `name`, `description`, `unit`, `unitPriceCents`, `vatRate` (inteiro, em %), `active`. Taxas de IVA disponíveis: Madeira 5/12/22, Continente 6/13/23, Açores 4/9/16 e 0 (isento, com motivo de isenção em texto). A região por omissão é uma definição do tenant no CRM (para a HelderLabs: Madeira).
- `CrmProposal`: `number` (sequencial por tenant e por ano, `PRP-2026-0001`, gerado com uma tabela contador e um lock na transação, nunca com `count()+1`), `companyId`, `contactId`, `dealId?`, `title`, `status` (`DRAFT`, `SENT`, `VIEWED`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `SUPERSEDED`), `validUntil`, `introText`, `terms`, totais em cêntimos, `currentVersion`, `ownerUserId`, `deletedAt`.
- `CrmProposalLine`: `productId?`, `description`, `quantity` (Decimal 12,3), `unitPriceCents`, `discountPct` (Decimal 5,2), `vatRate`, `lineNetCents`, `lineVatCents`, `lineTotalCents` (calculados **no servidor**), `position`.
- `CrmProposalVersion` (**imutável**, com trigger): `version`, `snapshot` (JSON canónico com a proposta e as linhas), `sha256` do snapshot, `pdf` (bytea, máx. 2 MB) ou chave no armazenamento usado pelo 2SELLMAIS, `sentAt`, `sentTo`.
- `CrmProposalAccessToken`: hash SHA-256 do token (o token em claro nunca é guardado), `proposalId`, `version`, `expiresAt`, `usedAt`.

### Funcionalidades
1. **Editor de propostas:** linhas a partir do catálogo ou livres, desconto por linha, resumo de IVA por taxa, totais. Pré-visualização do PDF.
2. **PDF no servidor com `pdf-lib`:** logótipo e dados da empresa (`TenantBranding`/`TenantCompanyProfile`), número, data, validade, cliente, linhas, resumo de IVA, totais, termos, ligação de aceitação e a frase **"Este documento não é uma fatura."**
3. **Enviar** com `TenantMailService.send` (`context: 'crm.proposal'`, `relatedType: 'CrmProposal'`):
   - Em modo SMTP vai o PDF em anexo e a ligação. Em modo plataforma vai só a ligação, e o ecrã explica porquê.
   - Bloqueia o envio se o contacto tiver `emailOptOut` ou estiver na lista de bloqueio da B6.
   - Ao enviar, cria a versão imutável, passa a proposta a `SENT`, move o negócio para `PROPOSAL` se estiver antes disso e regista uma atividade.
4. **Editar uma proposta enviada** cria uma nova versão. A anterior fica `SUPERSEDED` e o token antigo é invalidado.
5. **Página pública de aceitação** `GET /p/:token`, renderizada no servidor:
   - Mostra a versão enviada, só de leitura e com tudo escapado.
   - **Aceitar** pede nome e confirmação. **Recusar** pede motivo opcional.
   - Regista data/hora, IP, user agent e o `sha256` da versão aceite.
   - Ao aceitar: proposta `ACCEPTED`, negócio `WON`, empresa `CUSTOMER`, atividade, e email ao responsável pela proposta.
   - Ao abrir pela primeira vez, passa a `VIEWED`. **Sem pixel de rastreio.**
   - `noindex`, rate limit e token expirado → página "Proposta expirada".
6. **Expiração automática:** propostas `SENT`/`VIEWED` com `validUntil` passado mudam para `EXPIRED` (verificação na leitura; cron opcional).
7. **Duplicar proposta** e **modelos de texto** (introdução e termos) por tenant.

**Testes mínimos:**
- Cálculo com quantidades decimais, descontos e várias taxas de IVA (arredondamento ao cêntimo).
- Numeração sem duplicados com 20 criações em paralelo.
- A versão enviada é imutável (UPDATE na base de dados falha).
- Token: guardado só o hash, expirado é recusado e um token usado não aceita duas vezes.
- A aceitação muda a proposta, o negócio e a empresa.
- O envio a um contacto com opt-out é bloqueado.
- O PDF contém "Este documento não é uma fatura." (extrair texto no teste).
- O conteúdo malicioso na proposta sai escapado na página pública.

---

## B5 — Conta corrente (registo, sem faturação)

Mostra por cliente o que ele deve e o que pagou, a partir de documentos emitidos **noutro software** (certificado) e dos pagamentos recebidos.

### Modelos novos
- `CrmAccountEntry` (**imutável**, com trigger): `companyId`, `entryDate`, `type` (`OPENING_BALANCE`, `INVOICE`, `DEBIT_NOTE`, `CREDIT_NOTE`, `PAYMENT`, `REFUND`, `ADJUSTMENT`, `REVERSAL`), `externalDocumentNumber` (obrigatório para INVOICE, DEBIT_NOTE e CREDIT_NOTE), `dueDate` (documentos a débito), `amountCents` (sempre positivo; o sinal resulta do tipo), `method` (pagamentos: `TRANSFER`, `MBWAY`, `MULTIBANCO`, `CASH`, `CARD`, `DIRECT_DEBIT`, `OTHER`), `reference`, `notes`, `proposalId?`, `reversesEntryId?`, `createdBy`, `createdAt`.
- `CrmAccountAllocation`: `paymentEntryId`, `documentEntryId`, `amountCents`. O servidor garante que nem o pagamento nem o documento ficam com mais alocado do que o seu valor.

### Regras
- **Não há editar nem apagar.** Um engano corrige-se com um lançamento `REVERSAL` que referencia o original e anula o seu efeito (e as suas alocações). O original fica visível como "Estornado".
- O ecrã diz claramente: "Registo de documentos emitidos no seu software de faturação. O HelderLabs não emite faturas."
- Ao aceitar uma proposta, o ecrã sugere "Registar documento emitido", com o valor pré-preenchido e o número do documento externo vazio, de preenchimento obrigatório.

### Funcionalidades
1. **Extrato por cliente** com saldo corrente acumulado, filtro por período e estado (em aberto/liquidado). Exportação em PDF (`pdf-lib`, com a frase "Extrato informativo — não é um documento fiscal") e CSV. Envio do extrato por email com `TenantMailService`.
2. **Registar pagamento** com alocação automática aos documentos mais antigos em aberto, ou manual.
3. **Saldos:** total em dívida, vencido e antiguidade (0–30, 31–60, 61–90, mais de 90 dias) por cliente e global.
4. **Lista de cobranças:** documentos vencidos com envio manual de lembrete (modelo de texto editável), registado como atividade.

**Testes mínimos:** saldo e antiguidade com dados conhecidos. O estorno anula o efeito e as alocações. UPDATE/DELETE na base de dados falham. Alocar mais do que o valor devolve 400. A saída não contém nenhum campo de natureza fiscal (ATCUD, hash, certificado).

---

## B6 — Email comercial e RGPD

1. **Escrever email** a partir da ficha, para um contacto, com modelos e variáveis (`{{contacto.nome}}`, `{{empresa.nome}}`, `{{utilizador.nome}}`). Envio com `TenantMailService` e registo como atividade `EMAIL OUT`. Modelo `CrmEmailTemplate` por tenant.
2. **Cancelar subscrição:** todos os emails comerciais (não os de proposta pedida pelo cliente) levam a ligação `GET /u/:token`, com token assinado e sem dados pessoais no URL. Abrir a ligação marca `emailOptOut` e cria uma entrada em `CrmEmailSuppression` (tenant e email em minúsculas). O envio para endereços nessa lista é recusado com mensagem clara.
3. **Direitos do titular:** exportar os dados de um contacto (JSON) e **anonimizar** um contacto (nome "Contacto anonimizado", email, telefone e notas apagados). Não se apaga nada que esteja ligado à conta corrente ou a propostas enviadas. Auditado.
4. Envio em lote **não** faz parte desta fase.

**Testes mínimos:** o token de cancelamento é válido e adulterado é recusado. Um endereço na lista de bloqueio não recebe. A anonimização mantém as relações e remove os dados pessoais. As variáveis dos modelos são escapadas no HTML.

---

## B7 — Painel e relatórios

1. **Painel do CRM**, com filtros de período e responsável:
   - pipeline por fase (contagem, valor e ponderado)
   - previsão por mês de fecho esperado
   - taxa de ganho e ciclo médio em dias
   - conversão por origem
   - propostas enviadas, aceites e taxa de aceitação
   - valor em dívida e vencido
   - tarefas em atraso
   - negócios sem próximo passo
   
   Tudo calculado com SQL e agregações.
2. **Gráficos em SVG** feitos à mão, sem bibliotecas externas. Seguem os tokens, ficam legíveis em claro e escuro, têm `title`/`aria-label` e uma tabela alternativa.
3. **Exportação CSV** de empresas, contactos, negócios, propostas e conta corrente (respeitando permissões e filtros).

**Testes mínimos:** cada métrica com um conjunto de dados conhecido. As métricas não contam registos arquivados nem de outro tenant.

---

## B8 — Permissões

1. **Catálogo:**
   - `crm.company.read`, `crm.company.write`, `crm.company.archive`
   - `crm.deal.read`, `crm.deal.write`
   - `crm.activity.write`
   - `crm.proposal.read`, `crm.proposal.write`, `crm.proposal.send`
   - `crm.account.read`, `crm.account.write`
   - `crm.import`, `crm.export`, `crm.reports`, `crm.settings`
2. Atualiza `module.manifest.ts` e regista as permissões seguindo o padrão existente de `Permission`/`RolePermission` (vê como o HCCALL e o 2SELLMAIS o fazem). Papéis por omissão:
   - administrador: tudo
   - `MANAGER`: tudo exceto `crm.settings`
   - `SALES`: ler e escrever empresas, negócios, atividades e propostas, e enviar propostas; conta corrente só de leitura; sem importar nem exportar
   - `READ_ONLY`: só leitura
3. Aplica `requirePermission` a todas as rotas do CRM. O front-end esconde as ações sem permissão, mas é o servidor que decide.

**Testes mínimos:** matriz papel × rota (permitido/recusado) para todas as rotas de escrita.

---

## Relatório final da Parte B

Depois da B8, escreve `Claude outputs/RELATORIO_ANTIGRAVITY_CRM_FINAL.md` com:
- a lista de funcionalidades entregues por fase, com o commit e o deploy de cada uma;
- as decisões tomadas (`DECISOES.md`);
- os testes (número por fase, output real);
- as capturas de ecrã principais;
- os problemas conhecidos e a dívida técnica que fica;
- o que o Hélder deve validar manualmente.

Atualiza `ESTADO.md` e `CHANGELOG.md` em cada fase.
