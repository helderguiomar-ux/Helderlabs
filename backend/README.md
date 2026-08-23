# HelderLabs ERP — Backend

## Stack escolhida

| Camada        | Escolha                    | Porquê |
|---------------|-----------------------------|--------|
| Runtime       | Node.js + TypeScript        | Tipagem forte é importante num ERP onde os módulos partilham modelo de dados — evita erros de integração entre módulos. |
| API           | Fastify                     | Baixa sobrecarga, validação de schema nativa, ecossistema de plugins que mapeia bem para arquitetura modular (`app.register(modulo, {prefix})`). |
| ORM           | Prisma                      | Schema único e explícito (`schema.prisma`) funciona como o "modelo de dados integrado" que o projeto exige — todos os módulos leem/escrevem contra o mesmo contrato. |
| Base de dados | PostgreSQL                  | Suporta bem relações complexas entre módulos e é o standard para este tipo de sistema. |
| Validação     | Zod                         | Validação de payloads de API alinhada com os tipos TypeScript. |
| Auth          | JWT + Prisma Client Extension | Multi-tenant: o token transporta `tenantId` + `role`; um Prisma Client Extension aplica esse `tenantId` a toda a query automaticamente (ver secção "Autenticação e multi-tenancy" abaixo). |
| Login social  | OAuth 2.0 + OpenID Connect (`jose`) | Google/Microsoft/Apple, com verificação criptográfica do `id_token` via JWKS de cada provider — nunca confiamos num email só porque "veio de lá" (ver secção "Login social" abaixo). |

## Estrutura de pastas

```
backend/
  prisma/
    schema.prisma        # modelo de dados único e partilhado por todos os módulos
    seed.ts               # tenant_demo + utilizador demo (com password) + 2º tenant p/ testar isolamento
  public/
    index.html            # frontend estático mínimo (login + CRM + Condomínios: condomínios/frações)
  src/
    database/prisma/
      client.ts            # singleton do PrismaClient (lazy)
      tenantScopedClient.ts # Prisma Client Extension — carimba/filtra tenantId em toda a query
    plugins/
      authenticate.ts       # plugin Fastify: valida JWT, decora request.user + request.db
    modules/
      auth/                 # login (JWT, email + Google/Microsoft/Apple)
        oauth/               # protocolo OAuth: providers, PKCE, state, verificação de id_token
        services/
        controllers/
        routes/
      crm/                  # implementado: Lead -> Opportunity -> Customer (agora protegido por JWT)
        services/
        controllers/
        routes/
      condominios/          # implementado (CRUD mínimo): Building -> Unit
        services/
        controllers/
        routes/
      sales/               # stub — ver README do módulo
      invoicing/           # stub — ver README do módulo
      finance/             # stub — ver README do módulo
      tasks/               # stub — ver README do módulo
    app.ts                 # monta o Fastify, serve public/ em "/" e regista cada módulo
    server.ts               # arranca o servidor HTTP
```

## Frontend

`public/index.html` é um frontend estático mínimo (HTML/CSS/JS puro, sem
build step) servido pelo próprio Fastify em `/`. Não é a interface final do
HelderLabs ERP — é o suficiente para veres e clicares no fluxo do CRM
(login → criar Lead → Converter em Oportunidade → Ganhar → Cliente) antes de
existir um frontend "a sério" (framework, design system, etc.). Quando esse
frontend for construído, este ficheiro pode ser substituído sem tocar no
backend, porque fala com a API pelas mesmas rotas HTTP.

Cada módulo é uma "fatia vertical" (services + controllers + routes), mas
todos partilham o mesmo `schema.prisma` — é assim que se cumpre o princípio
de "não quero módulos isolados, quero um modelo de dados integrado" definido
nas instruções do projeto.

## Autenticação e multi-tenancy

Duas camadas independentes, de propósito — se uma falhar (ex.: um developer
esquece-se de algo numa rota nova), a outra continua a proteger os dados:

**Camada 1 — no pedido HTTP (`src/plugins/authenticate.ts`).**
Toda a rota protegida usa `app.authenticate` como `preHandler`. Este hook:
1. Lê `Authorization: Bearer <token>` e valida o JWT (`jsonwebtoken`, chave
   `JWT_SECRET` do `.env`, expiração `JWT_EXPIRES_IN`).
2. Extrai `{ userId, tenantId, role, email }` **só do token** — nunca de
   query/body/params. Antes desta mudança, o `tenantId` vinha de
   `?tenantId=...` na query, o que significava que qualquer cliente podia
   simplesmente pedir os dados de outro tenant.
3. Decora `request.user` (para os controllers saberem quem está autenticado)
   e `request.db` (um Prisma Client já "amarrado" ao tenant — ver camada 2).

**Camada 2 — na query à base de dados (`src/database/prisma/tenantScopedClient.ts`).**
`forTenant(tenantId)` devolve um Prisma Client Extension (`$extends`) que
reescreve automaticamente os argumentos de qualquer query num modelo
tenant-scoped (`Lead`, `Opportunity`, `Customer`, `Communication`):
- leituras (`findMany`, `findUnique`, `count`, ...) → `where.tenantId` injetado;
- `create`/`createMany` → `data.tenantId` carimbado;
- `update`/`delete`/`upsert` → `where`/`create` carimbados.

Isto é defesa em profundidade: mesmo que um service futuro (Vendas,
Faturação, ...) se esqueça de filtrar por tenant numa query, a extensão
corrige isso ao nível dos dados — nenhuma query tenant-scoped consegue "ver"
ou escrever fora do tenant do pedido, mesmo que tente.

**Corrigido de caminho:** `EnterpriseCRMService.convertLeadToOpportunity` e
`winOpportunityAndCreateCustomer` procuravam a Lead/Opportunity só por `id`,
sem verificar `tenantId` — ou seja, era possível (em teoria, sabendo o id)
converter/ganhar registos de outro tenant. Corrigido ao mesmo tempo que a
autenticação, com teste de regressão em `tests/crm/EnterpriseCRMService.test.ts`
("rejeita Lead/Opportunity que pertence a OUTRO tenant").

**Limitação conhecida:** o modelo `Contact` não tem `tenantId` próprio (só
`customerId`) — o isolamento dele é transitivo via `Customer`. Não está
coberto pela extensão; fica como TODO para quando o módulo de contactos
crescer.

**Limitação da sandbox:** a extensão (`forTenant`) só pode ser validada
"fim-a-fim" com o Prisma Client gerado (`prisma generate`, que precisa de
rede para `binaries.prisma.sh`) e uma base de dados real — o que este
ambiente de desenvolvimento não tem. Por isso a lógica de reescrita de
queries está isolada numa função pura, testável sem Prisma
(`buildTenantScopedArgs`, ver `tests/database/tenantScopedClient.test.ts`),
mas o teste de integração completo (contra Postgres real) é o próximo passo
a correr no teu ambiente local, depois de `npm run prisma:migrate`.

## Login social (Google/Microsoft/Apple) e Super Admin

Além de email/password, `/api/auth/oauth/:provider/start` (`provider` =
`google` | `microsoft` | `apple`) inicia o login social. Fluxo (OAuth 2.0
Authorization Code + PKCE + OpenID Connect):

1. `GET /api/auth/oauth/:provider/start` — o backend gera um `code_verifier`
   (PKCE) e um `nonce`, mete os dois dentro de um `state` assinado (JWT de
   5 min), e redireciona o browser para o ecrã de consentimento do provider.
   Não há sessão do lado do servidor — tudo o que o callback precisa viaja
   dentro do próprio `state`, assinado, por isso não é adulterável.
2. O provider autentica o utilizador e traz o browser de volta para
   `GET /api/auth/oauth/:provider/callback?code=...&state=...`.
3. O backend troca o `code` por um `id_token` junto do provider (com o
   `client_secret` — ou, no caso da Apple, um client_secret gerado na hora,
   ver `oauth/appleClientSecret.ts`) e **verifica a assinatura desse
   `id_token` contra a chave pública (JWKS) do próprio provider**
   (`oauth/verifyIdToken.ts`, via `jose`) — assinatura, `issuer`, `audience`
   (o nosso `client_id`) e `nonce`. Só depois disto o email é considerado
   de confiança.
4. `AuthService.loginOrRegisterWithOAuth()` decide o que fazer com esse
   email verificado (ver regras abaixo) e emite o mesmo JWT de sempre —
   dali em diante é indistinguível de um login por password.
5. Redirecionamento final para `/#token=<jwt>` — no **fragmento** do URL, de
   propósito, porque fragmentos nunca são enviados ao servidor nem ficam em
   logs/`Referer`. O frontend lê o hash no arranque, guarda o token e limpa
   o URL. Um erro (conta desconhecida, email não verificado, ...) vem antes
   como `/?oauthError=...` — aí não há nada sensível a esconder.

**Regra do Super Admin (o que foi pedido):** o email definido em
`DEFAULT_SUPER_ADMIN_EMAIL` (`.env`, hoje `helderguiomar@gmail.com`) é
promovido a `SUPER_ADMIN` automaticamente, **por qualquer método de login**
— Google, Microsoft, Apple ou email/password:
- Se esse email faz login pela primeira vez (nunca existiu como `User`),
  é criado na hora com `role: SUPER_ADMIN`, num tenant dedicado
  (`tenant_platform`, criado automaticamente — não é um tenant de cliente).
- Se esse email já existir como utilizador normal (ex.: seed, ou convite
  futuro), é promovido a `SUPER_ADMIN` no primeiro login seguinte, seja
  qual for o método.
- Qualquer outro email só faz login OAuth se já existir como `User` — um
  login social de um email nunca visto **não cria um tenant novo
  automaticamente**. Isto é uma decisão deliberada (ver
  `UnknownAccountError` em `AuthService.ts`): sem isto, "login com Google"
  seria equivalente a "signup público sem controlo nenhum", o que não foi
  pedido. Fica documentado como decisão a rever quando existir convite de
  utilizadores — por agora, novas contas continuam a ser criadas por
  `prisma/seed.ts` (ou diretamente na BD).

**Nota importante sobre o que `SUPER_ADMIN` faz hoje:** é só um valor de
`role` — nenhuma rota verifica ainda permissões por role (não há RBAC).
Continua "preso" ao seu próprio tenant (`tenant_platform`) tal como
qualquer outro utilizador — não vê já dados de outros tenants no CRM. Dar-lhe
visão cross-tenant é uma mudança de comportamento maior (a extensão da
secção anterior teria de saber ignorar o filtro de tenant só para este
role) que não foi pedida nesta fase; fica como próximo passo natural.

**Configuração necessária (`.env`):** cada provider só fica ativo quando as
suas env vars existem — sem elas, `/start` devolve `503` em vez de
rebentar o arranque do servidor. Instruções passo a passo de onde obter
cada credencial estão como comentários em `.env.example`. Resumo:

| Provider | Funciona em `localhost`? | O que precisas de criar |
|---|---|---|
| Google | Sim | OAuth Client ID (tipo "Web application") na Google Cloud Console |
| Microsoft | Sim | App registration no Entra ID (Azure AD) |
| Apple | **Não** — exige `redirect_uri` HTTPS num domínio verificado | Services ID + chave privada `.p8` no Apple Developer Portal |

**Testado nesta sandbox (sem credenciais reais):** arranque do servidor com
as rotas registadas, `503` correto quando um provider não está configurado,
`400` correto para um nome de provider inválido, redirecionamento correto
para o ecrã de consentimento do Google com `state`/PKCE bem formados, e
redirecionamento de erro (`?oauthError=...`) quando o provider devolve
`error=access_denied`. A troca de `code` por `id_token` (passo 3) só é
testável com credenciais reais de um provider — próximo passo no teu
ambiente.

## Módulo Condomínios (Gestão de Condomínios)

Novo módulo, construído dentro deste mesmo skeleton JWT/OAuth (decisão
explícita: reutilizar o isolamento multi-tenant já testado em vez de
implementar este módulo no outro projeto — ver `src/modules/condominios/`).

**Modelo de dados** (`prisma/schema.prisma`): `Building` (o condomínio em
si — tem `tenantId` diretamente, tal como `Lead`/`Opportunity`/`Customer`) e,
pendurados nele por relação em vez de `tenantId` próprio: `Unit` (frações),
`Owner` (proprietários — ainda sem ligação a tenant, ver limitação abaixo),
`Fee` (quotas, por `Unit`), `Assembly` + `Vote` (assembleias e votos) e
`Expense` (despesas do condomínio). Esta escolha — um único "ponto de
ancoragem" (`Building.tenantId`) com tudo o resto pendurado por relação —
segue o mesmo padrão que `Customer`/`Contact` já usava no CRM.

**Isolamento transitivo, não direto.** A Camada 2 da extensão Prisma
(`tenantScopedClient.ts`) só sabe carimbar/filtar `tenantId` em modelos que
o têm diretamente — por isso `Building` foi acrescentado a
`TENANT_SCOPED_MODELS`, mas `Unit`, `Fee`, `Assembly`, `Vote` e `Expense`
não podem ser (não têm a coluna). Para estes, o isolamento é feito no
service layer: `EnterpriseCondominiosService.requireOwnedBuilding()` busca
sempre o `Building` filtrado pelo `tenantId` do pedido antes de tocar em
qualquer `Unit` associada — se o `Building` pertence a outro tenant (ou não
existe), a operação falha com `BuildingNotFoundError` em vez de vazar dados.
É o mesmo princípio de defesa em profundidade da secção anterior, só que
aplicado manualmente onde a extensão automática não chega. Testado em
`tests/condominios/EnterpriseCondominiosService.test.ts` (cria/lista
Building, cria/lista Unit quando o Building é do tenant certo, e rejeita
nos dois casos — Building de outro tenant, Building inexistente).

**Alcance atual (CRUD mínimo, de propósito):** só `Building` e `Unit` têm
service/controller/rotas/frontend — o suficiente para provar o modelo de
dados na prática, à semelhança do MVP que o CRM foi no início. `Fee`,
`Assembly`, `Vote` e `Expense` já existem no schema (para não bloquear
migrações futuras) mas ainda sem lógica de negócio por cima.

**Gap conhecido:** `Owner` ainda não tem nenhuma ligação a `tenantId` nem a
`Building` no schema — fica por decidir no próximo passo (é 1-para-1 ou
N-para-N com `Unit`? um Owner pode ter frações em condomínios de tenants
diferentes?) antes de lhe dar isolamento e CRUD.

Rotas novas (mesmo contrato dos outros módulos — `Authorization: Bearer
<token>` obrigatório, `tenantId` nunca vindo do cliente):

- `POST /api/condominios/buildings` — cria um condomínio
- `GET /api/condominios/buildings` — lista os condomínios do tenant autenticado
- `POST /api/condominios/buildings/:buildingId/units` — cria uma fração (rejeita se o `buildingId` não for de um condomínio do tenant)
- `GET /api/condominios/buildings/:buildingId/units` — lista as frações de um condomínio (mesma verificação)

O seed (`prisma/seed.ts`) cria um condomínio de demonstração
(`Edifício Central`, no `tenant_demo`) com duas frações, e `public/index.html`
tem uma secção "Condomínios" — cria/lista condomínios, e ao clicar num
(botão "Ver frações") mostra as suas frações e permite criar novas.

## Como correr localmente

```bash
cd backend
cp .env.example .env        # já vem com JWT_SECRET/JWT_EXPIRES_IN de dev — ajustar DATABASE_URL
npm install
npm run prisma:migrate      # cria as tabelas na base de dados
npm run seed                # cria tenant_demo + utilizador demo@helderlabs.pt (password: Demo@2026)
npm run dev                 # arranca em http://localhost:3333
```

Abre `http://localhost:3333/` no browser — vais ver um ecrã de login antes
do CRM. Usa `demo@helderlabs.pt` / `Demo@2026` (criado pelo seed). Para
testares o isolamento entre tenants, o seed cria também
`outro-tenant@helderlabs.pt` (mesma password) num tenant completamente
separado — inicia sessão com ele e confirma que não vês nenhum dado do
`tenant_demo`.

Rotas da API:

- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`
- `GET /api/auth/oauth/:provider/start` — inicia login social (`google`|`microsoft`|`apple`), redireciona
- `GET /api/auth/oauth/:provider/callback` — callback do provider, redireciona para `/#token=...`
- `GET /api/auth/me` — utilizador atual (requer `Authorization: Bearer <token>`)
- `POST /api/crm/leads` — cria uma Lead (tenant vem do token)
- `GET /api/crm/leads` — lista Leads do tenant autenticado
- `POST /api/crm/leads/:leadId/convert` — converte Lead em Opportunity
- `GET /api/crm/opportunities` — lista Opportunities do tenant autenticado
- `POST /api/crm/opportunities/:opportunityId/win` — fecha Opportunity e cria Customer
- `GET /api/crm/customers` — lista Customers do tenant autenticado
- `GET /api/crm/dashboard` — indicadores comerciais
- `POST /api/condominios/buildings` — cria um condomínio (tenant vem do token)
- `GET /api/condominios/buildings` — lista condomínios do tenant autenticado
- `POST /api/condominios/buildings/:buildingId/units` — cria uma fração
- `GET /api/condominios/buildings/:buildingId/units` — lista frações de um condomínio

Todas as rotas `/api/crm/*` e `/api/condominios/*` exigem `Authorization:
Bearer <token>` — sem token devolvem `401`.

## Como testar

Há dois níveis de teste, com propósitos diferentes:

### 1. Testes unitários da lógica de negócio (rápidos, sem base de dados)

```bash
npm test
```

- `tests/crm/EnterpriseCRMService.test.ts` — conversão de Lead em
  Opportunity, fecho de Opportunity com criação de Customer e migração de
  histórico, cálculo de indicadores do dashboard, **e isolamento
  multi-tenant** (uma Lead/Opportunity de outro tenant não pode ser lida
  nem alterada).
- `tests/auth/AuthService.test.ts` — login com password correta/errada,
  utilizador inexistente, utilizador inativo, conta só-OAuth sem password,
  **promoção automática a SUPER_ADMIN** (por email/password e por OAuth,
  incluindo criação do tenant da plataforma no primeiro login), e login
  social rejeitado para email desconhecido/não verificado.
- `tests/auth/oauth/pkce.test.ts` — geração de `code_verifier`/`nonce` e o
  cálculo do `code_challenge` (S256), validado contra o vetor de teste
  oficial da RFC 7636 — sem rede, sem depender de nenhum provider real.
- `tests/auth/oauth/oauthState.test.ts` — sign/verify do `state` OAuth
  (round-trip, rejeição de adulteração, rejeição de segredo diferente).
- `tests/database/tenantScopedClient.test.ts` — a reescrita de argumentos
  que a Prisma Client Extension aplica a cada tipo de operação
  (`findMany`, `create`, `update`, `upsert`, `createMany`), incluindo
  confirmar que `Building` é carimbado/filtrado e que `Unit` (sem
  `tenantId` direto) não é tocado pela extensão.
- `tests/condominios/EnterpriseCondominiosService.test.ts` — criação/
  listagem de `Building` com isolamento por tenant, criação/listagem de
  `Unit` quando o `Building` pertence ao tenant certo, e rejeição
  (`BuildingNotFoundError`) quando o `Building` é de outro tenant ou não
  existe — o isolamento transitivo descrito na secção "Módulo Condomínios"
  acima.

Nenhum destes precisa de Postgres nem de `prisma generate` — correm contra
um Prisma "fake" em memória (`tests/crm/support/fakePrismaClient.ts` e um
repositório fake equivalente em `tests/auth/`) ou contra funções puras, por
isso são o teste a correr sempre que mexeres na lógica de um serviço.

`npm test` corre `scripts/collect-and-run-tests.mjs` (não
`tsx --test tests/**/*.test.ts` diretamente) — descoberto ao adicionar
`tests/auth/oauth/`: esse glob só recursa corretamente sob bash com
`shopt -s globstar`; o `sh` que `npm run` usa por omissão (e o cmd.exe/
PowerShell no Windows) trata `**` como um `*` normal e ignora ficheiros a
dois níveis de profundidade **sem erro nenhum** — os testes ficavam de fora
em silêncio. O script novo descobre os ficheiros com `node:fs` em vez de
depender do glob do shell, por isso funciona igual em qualquer SO.

### 2. Teste end-to-end real (Postgres + API a correr)

```bash
cp .env.example .env        # ajustar DATABASE_URL
npm install
npm run prisma:migrate      # cria as tabelas
npm run seed                # cria tenant_demo / lead_demo / utilizador demo
npm run dev                 # noutro terminal: arranca em http://localhost:3333
bash scripts/smoke-test.sh  # login -> converte Lead -> ganha Opportunity -> dashboard -> confirma 401 sem token
```

## O que falta (por ordem de prioridade sugerida)

1. ~~Autenticação e multi-tenant middleware~~ — feito (JWT + Prisma Client
   Extension, ver secção acima). Falta validar `forTenant()` fim-a-fim
   contra um Postgres real (não é possível dentro desta sandbox).
2. ~~Seed de dados~~ — feito (`prisma/seed.ts`).
3. ~~Testes automatizados do `EnterpriseCRMService`~~ — feito (`tests/crm/`, `tests/auth/`, `tests/database/`).
4. ~~Login social (Google/Microsoft/Apple) + Super Admin automático~~ —
   feito (ver secção acima). Falta testar a troca de código por token
   contra credenciais reais de cada provider (impossível nesta sandbox), e
   decidir se/como permitir signup self-service para outros emails.
5. **RBAC por role** — hoje `role` (incluindo `SUPER_ADMIN`) é só um campo
   no token; nenhuma rota o verifica. Próximo passo natural depois de haver
   mais de um role que importe operacionalmente.
6. **Módulo Vendas**, depois **Faturação**, depois **Financeiro**, depois
   **Tarefas** — cada um com o seu README já preparado em `src/modules/*`.
   Todos devem usar `request.db` (client já amarrado ao tenant) em vez do
   client global — é esse o contrato que a autenticação agora garante.
6b. ~~Módulo Condomínios (base)~~ — feito: CRUD mínimo de `Building`/`Unit`
   (ver secção "Módulo Condomínios" acima). Falta: CRUD de `Fee`
   (quotas), `Assembly`/`Vote` (assembleias) e `Expense` (despesas) — o
   schema já os tem, só falta a lógica de negócio — e decidir o modelo de
   dados do `Owner` (hoje sem tenant/ligação a `Building`).
7. ~~Frontend~~ — existe um MVP estático (`public/index.html`) com login
   (email + Google/Microsoft/Apple). Um frontend "a sério" (framework,
   design system) continua por fazer.
8. Gestão de utilizadores (registo, reset de password, convites, ligar/
   desligar login social a uma conta existente) — hoje só existe login; os
   utilizadores são criados diretamente na base de dados (`prisma/seed.ts`)
   ou, no caso do super admin, automaticamente no primeiro login.
