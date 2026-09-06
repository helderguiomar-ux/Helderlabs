# ADENDA AO PROMPT DE EXECUÇÃO — Antigravity
## HelderLabs ERP · Fase 0.5 — Separação de Ambientes e Fluxo de Deploy

> **Esta fase insere-se entre a Fase 0 (segurança) e a Fase 1 (modelo de dados) do prompt principal (`docs/PROMPT_ANTIGRAVITY_PLATFORM.md`).**
>
> **PARA IMEDIATAMENTE se estiveres prestes a executar, ou já executaste, qualquer comando `prisma migrate` da Fase 1. Lê a secção 1 antes de continuar.**

---

## 1. PROBLEMA QUE ESTA FASE RESOLVE (verificado, não suposto)

`backend/.env` — o ficheiro carregado por `npm run dev` — contém um `DATABASE_URL` que aponta para a base de dados **Neon Cloud de produção**. Não existe base de dados local.

Consequências, todas ativas neste momento:

1. **Desenvolvimento local escreve em produção.** Cada teste manual, cada `npm run seed`, cada registo criado a experimentar altera dados reais de clientes reais.
2. **`prisma migrate dev` da Fase 1 aplica-se a produção.** As alterações previstas incluem remover o modelo `TenantModule` e adicionar colunas a `ApplicationInstance`. Executadas contra a Neon, são irreversíveis sem backup.
3. **`prisma migrate dev` pode propor um reset.** Se detetar drift entre o histórico de migrações e o estado real da base de dados, o comando oferece-se para recriar a base de dados de raiz. Contra produção, isso é perda total de dados — e o `--force-reset` proibido pelas regras do projeto não é sequer necessário para lá chegar.
4. **Não é possível testar antes de publicar.** Não há forma de validar uma alteração sem que ela já esteja a afetar o sistema em produção.
5. **Credenciais e dados pessoais reais numa máquina de trabalho.** Existe também um `.env.production` no disco local com valores de produção. Dados de clientes (nomes, emails, NIFs, quotas de condomínio) acessíveis a partir de qualquer sessão de desenvolvimento é um problema de RGPD, não apenas de higiene técnica.

**Ação imediata, antes de qualquer outra coisa:**

```bash
# 1. Backup completo da produção, ANTES de tocar em seja o que for
pg_dump "<DATABASE_URL_DE_PRODUCAO>" -F c -b -v -f backup_pre_fase1_$(date +%Y%m%d_%H%M).dump

# 2. Confirmar que o dump é restaurável (não confiar no ficheiro sem o testar)
pg_restore --list backup_pre_fase1_*.dump | head -30
```

Guarda o dump fora da diretoria do projeto. Só depois avança.

---

## 2. ARQUITETURA-ALVO DE AMBIENTES

Três ambientes, com fronteiras rígidas:

| Ambiente | Onde corre | Base de dados | Dados | Quem lhe toca |
|---|---|---|---|---|
| **local** | Máquina do Hélder, `npm run dev` | PostgreSQL em Docker, `localhost:5432` | Seed sintético ou dump anonimizado | Desenvolvimento e testes livres |
| **preview** | Vercel Preview (por branch/PR) | Neon branch efémero | Cópia anonimizada, descartável | Validação antes de merge |
| **production** | Vercel Production, `helderlabs.eu` | Neon `main` | Dados reais de clientes | Só via merge para `master` |

Regras não negociáveis:

1. **Nenhuma máquina local tem, em ficheiro, credenciais de produção.** Os valores de produção existem apenas nas Environment Variables da Vercel.
2. **`prisma migrate dev` só corre contra `localhost`.** Produção recebe migrações exclusivamente via `prisma migrate deploy`, no pipeline de deploy.
3. **Paridade de versões.** O PostgreSQL local tem de ser da mesma versão maior que a Neon. Deteta com `SELECT version();` contra a Neon e fixa a mesma major na imagem Docker.
4. **O código não sabe em que ambiente está.** Sem `if (isProduction)` a alterar comportamento de negócio. Tudo o que difere entre ambientes é configuração, e está declarado em `.env.example`.

---

## 3. IMPLEMENTAÇÃO

### 3.1 PostgreSQL local

Criar `docker-compose.yml` na raiz do projeto:

```yaml
services:
  postgres:
    image: postgres:<MAJOR_DA_NEON>-alpine
    container_name: helderlabs-erp-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: helderlabs
      POSTGRES_PASSWORD: local_dev_only
      POSTGRES_DB: helderlabs_erp
    ports:
      - "5432:5432"
    volumes:
      - helderlabs_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U helderlabs -d helderlabs_erp"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  helderlabs_pgdata:
```

`docker-compose.yml` **não** vai para o `.gitignore` — faz parte do projeto. A password aqui é irrelevante: a base de dados só escuta em `localhost` e não contém dados reais.

### 3.2 Ficheiros de ambiente

**`backend/.env.example`** (versionado, sem valores reais) — documenta **todas** as variáveis, incluindo as novas da Fase 0 (`ALLOW_DEV_OTP`, `SUPER_ADMIN_BOOTSTRAP_PASSWORD`) e as da Fase 2 (`MANIFEST_SIGNING_KEY`, se separada do `JWT_SECRET`).

**`backend/.env`** (local, ignorado pelo Git) — reescrever para apontar exclusivamente ao Docker:

```env
DATABASE_URL="postgresql://helderlabs:local_dev_only@localhost:5432/helderlabs_erp"
NODE_ENV=development
ENVIRONMENT=LOCAL
PORT=3333
ALLOW_DEV_OTP=true
JWT_SECRET=<segredo_local_gerado_aleatoriamente_diferente_do_de_producao>
ALLOWED_ORIGINS="http://localhost:3333,http://127.0.0.1:3333"
DEFAULT_SUPER_ADMIN_EMAIL=helderguiomar@gmail.com
# RESEND_API_KEY deliberadamente ausente: em local os OTP vão para a consola
```

**Eliminar do disco local:** `.env.production` (raiz e `backend/`). Esses valores passam a existir só na Vercel. Antes de eliminar, confirmar que cada variável lá presente já está configurada no dashboard da Vercel.

Confirmar que `backend/src/server.ts` e `api/index.ts` carregam o `.env` correto e que nenhum deles tem fallbacks embutidos com valores de produção.

### 3.3 Guarda contra comandos destrutivos — a peça central

Criar `backend/scripts/guard-db.mjs`. É executado **antes** de qualquer comando Prisma que altere schema, e aborta se a base de dados alvo não for local:

```js
// Recusa comandos de migração destrutivos fora de localhost.
// Isto existe porque, até esta fase, `npm run dev` e `prisma migrate dev`
// apontavam à base de dados de produção na Neon.
import { config } from 'dotenv';
config();

const url = process.env.DATABASE_URL ?? '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
const isLocal = ['localhost', '127.0.0.1', 'postgres', 'host.docker.internal'].includes(host);

if (!isLocal) {
  console.error('\n\x1b[41m ABORTADO \x1b[0m Comando destrutivo contra base de dados NÃO-LOCAL.');
  console.error(`  Host alvo : ${host || '(indecifrável)'}`);
  console.error('  Permitido : localhost / 127.0.0.1');
  console.error('\n  Migrações em produção aplicam-se via `prisma migrate deploy` no pipeline de deploy,');
  console.error('  nunca a partir de uma máquina de desenvolvimento.\n');
  process.exit(1);
}
console.log(`\x1b[32m✓\x1b[0m Base de dados local confirmada (${host}).`);
```

Ligar a guarda a todos os scripts perigosos em `backend/package.json`:

```json
{
  "scripts": {
    "db:up":        "docker compose -f ../docker-compose.yml up -d",
    "db:down":      "docker compose -f ../docker-compose.yml down",
    "db:guard":     "node scripts/guard-db.mjs",
    "db:migrate":   "npm run db:guard && prisma migrate dev",
    "db:reset":     "npm run db:guard && prisma migrate reset",
    "db:seed":      "npm run db:guard && tsx prisma/seed.ts",
    "db:studio":    "prisma studio",
    "db:deploy":    "prisma migrate deploy",
    "env:check":    "node scripts/env-check.mjs",
    "dev":          "npm run db:guard && tsx watch src/server.ts",
    "verify":       "npm run typecheck && npm test"
  }
}
```

Notas obrigatórias:

- **Remover** o script atual `"prisma:migrate": "prisma migrate dev --name init"`. Fixa o nome `init` em todas as migrações, o que produz um histórico ilegível e colisões. O novo `db:migrate` recebe o nome por argumento: `npm run db:migrate -- --name add_tenant_branding`.
- `db:deploy` **não** leva guarda — é o único caminho legítimo para produção, e corre no pipeline, não na máquina do Hélder.
- `dev` passa a ter guarda: se alguém repuser um `DATABASE_URL` de produção no `.env`, o servidor local recusa arrancar em vez de escrever em dados reais.

### 3.4 `env-check.mjs` — paridade verificável

Criar `backend/scripts/env-check.mjs` que lê `.env.example` e verifica que todas as chaves lá declaradas existem no ambiente atual, falhando com a lista das que faltam. Correr no arranque de `dev` e no pipeline de deploy. É isto que impede o clássico "funciona local, rebenta em produção porque falta uma variável".

### 3.5 Dados locais realistas

Dois caminhos, ambos implementados:

**a) Seed sintético (por omissão, sem rede)** — evoluir `backend/prisma/seed.ts` para cobrir os casos que interessam testar, não apenas o caminho feliz:

- 4 tenants: um com todas as apps `ACTIVE`; um com CRM `ACTIVE` e Finance `TRIAL` a expirar em 3 dias; um em `GRACE`; um `SUSPENDED` por não pagamento
- Utilizadores em cada papel, incluindo um `PENDING_APPROVAL` e um sem qualquer `ApplicationAssignment`
- `TenantBranding` distinto em pelo menos dois tenants (logos e cores diferentes), para validar visualmente o branding
- Limites deliberadamente perto do topo num tenant, para testar `LIMIT_EXCEEDED` sem criar 5.000 registos

Este seed é a definição executável dos cenários de teste. Vale mais do que qualquer documento.

**b) Espelho anonimizado de produção (`npm run db:mirror`)** — script que faz `pg_dump` da Neon, restaura em local e **imediatamente** corre um `anonymize.sql` que substitui todos os dados pessoais: emails para `utilizador+<id>@exemplo.local`, nomes por nomes gerados, telefones, NIFs, moradas e `passwordHash` para um valor fixo conhecido. A anonimização corre na mesma transação do restauro — nunca deve existir uma janela em que dados reais estejam em disco local em claro. Usar só quando for preciso reproduzir um problema específico com volume real.

### 3.6 Paridade local ↔ produção

Para que "testar localmente tal como está online" seja verdade e não uma aproximação:

- **Mesma versão de Node** — fixar em `package.json` (`"engines": { "node": ">=20 <21" }`) e alinhar com a runtime da Vercel
- **Mesma major de PostgreSQL** — imagem Docker igual à da Neon
- **Testar também o caminho serverless** — `npm run dev` corre `server.ts` (standalone), mas produção corre `api/index.ts` (serverless). São caminhos de código diferentes. Acrescentar `npm run dev:serverless` com `vercel dev`, e validar aí os fluxos críticos (login, manifesto, guards) antes de qualquer deploy. Falhas que só aparecem em serverless — estado em memória entre invocações, cold starts, ausência de listeners — não se veem no modo standalone.
- **Rate limiting**: em local o store em memória funciona; em serverless não. Documenta a divergência em vez de a esconder.

---

## 4. FLUXO DE TRABALHO E DEPLOY

O fluxo passa a ser este, e o agente segue-o sem precisar de instrução caso a caso:

```
1. branch          git checkout -b feat/<descrição>
2. local           npm run db:up && npm run db:migrate -- --name <nome> && npm run db:seed
                   npm run dev            → validar em http://localhost:3333
                   npm run dev:serverless → validar o caminho de produção
3. verificar       npm run verify         (typecheck + testes; tem de passar)
4. push            git push -u origin feat/<descrição>
                   → Vercel gera Preview URL com Neon branch próprio
5. validar preview percorrer o checklist da secção 5 contra o URL de preview
6. merge           PR para master, após aprovação explícita do Hélder
7. produção        pipeline: env-check → prisma migrate deploy → build → deploy
8. pós-deploy      smoke test contra helderlabs.eu (secção 5.3)
```

**Regras de deploy:**

- **`master` está sempre publicável.** Nada entra sem `npm run verify` verde e sem validação em preview.
- **Migração e código vão juntos, e a migração é retrocompatível.** Uma coluna nova entra como opcional ou com default; só é tornada obrigatória num deploy seguinte, depois de o código novo estar a correr. Remoções de coluna (como `TenantModule`) fazem-se em dois deploys: primeiro o código deixa de as usar, depois removem-se.
- **Nunca `vercel --prod` a partir da máquina local** sem passar pelos passos 2 a 5. O comando existe; a disciplina é não o usar como atalho.
- **Backup antes de cada deploy que inclua migração.** Automatizar em `npm run db:backup:prod`, com o ficheiro guardado fora do repositório.
- **Plano de reversão escrito antes do deploy**, não improvisado depois: Instant Rollback na Vercel repõe o código, mas **não reverte a migração**. Por isso as migrações têm de ser retrocompatíveis — é o que torna o rollback de código suficiente na esmagadora maioria dos casos.

---

## 5. CHECKLISTS DE VALIDAÇÃO

### 5.1 Local (antes de push)

- [ ] `npm run verify` verde
- [ ] `npm run dev` arranca contra `localhost` (a guarda confirma-o na consola)
- [ ] `npm run dev:serverless` serve as mesmas páginas sem erro
- [ ] Login com cada um dos 4 tenants do seed
- [ ] Workspace mostra o conjunto correto de apps em cada estado (`ACTIVE`, `TRIAL`, `GRACE`, `SUSPENDED`, `NONE`)
- [ ] Branding distinto visível entre tenants
- [ ] `/api/crm/leads` responde `403 APP_NOT_LICENSED` no tenant sem CRM
- [ ] Consola sem erros de JavaScript

### 5.2 Preview (antes de merge)

- [ ] Migrações aplicadas ao Neon branch sem intervenção manual
- [ ] `env-check` passou
- [ ] Fluxo de login completo, incluindo OTP real por email
- [ ] Impersonation: banner visível, escrita bloqueada em modo leitura, auditoria com `onBehalfOfId`
- [ ] Testado em viewport de telemóvel

### 5.3 Produção (imediatamente após deploy)

- [ ] `GET /api/health` devolve `database: ready`
- [ ] `POST /api/auth/demo-login` devolve `404`
- [ ] `verify-otp` com `123456` devolve `401`
- [ ] Login real do super admin funciona
- [ ] Um tenant real abre o workspace com as apps corretas
- [ ] `verifyAuditChain()` devolve cadeia íntegra

---

## 6. ENTREGÁVEIS DESTA FASE

1. `docker-compose.yml`
2. `backend/scripts/guard-db.mjs` e `backend/scripts/env-check.mjs`
3. `backend/.env.example` completo; `backend/.env` a apontar a localhost; `.env.production` removido do disco local
4. `backend/package.json` com os scripts da secção 3.3
5. `backend/prisma/seed.ts` com os 4 cenários da secção 3.5
6. `backend/scripts/db-mirror.mjs` + `anonymize.sql`
7. `docs/ENVIRONMENTS.md` — documento único que descreve os três ambientes, como arrancar cada um, como deployar e como reverter
8. `CLAUDE.md` atualizado com a regra: **migrações só via `npm run db:migrate` em local; produção só via pipeline**

---

## 7. ORDEM CORRIGIDA DE EXECUÇÃO

```
FASE 0    Segurança bloqueante          → deploy imediato e isolado
FASE 0.5  ESTA FASE — ambientes         → sem isto, a Fase 1 escreve em produção
FASE 1    Modelo de dados               → primeiro em local, depois preview, depois produção
FASE 2-7  (conforme prompt principal)
FASE 8    Verificação e relatório
```

**A Fase 1 não começa antes de a Fase 0.5 estar concluída e do backup de produção estar verificado.** Se já iniciaste a Fase 1, para, confirma o estado da base de dados Neon contra o backup, e só retoma depois desta fase.
