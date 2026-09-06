# PROMPT DE EXECUÇÃO — Antigravity
## HelderLabs ERP · Camada de Plataforma: Licenciamento, Personalização, Super Admin e Workspace do Utilizador

> **Instrução ao agente:** Este documento é a especificação completa da tarefa. Lê-o na íntegra antes de escrever código. Não improvises fora do que aqui está definido; onde tiveres dúvida, pergunta antes de implementar. Trabalha por fases, pela ordem indicada, e produz o relatório final da Fase 8.

---

## 0. CONTEXTO DO PROJETO (verificado no repositório, não assumido)

**Diretoria canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`

**Stack real (confirma sempre no código, não na documentação):**

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + **Fastify 4** + TypeScript strict |
| ORM / BD | Prisma 5 + PostgreSQL (Neon Cloud) |
| Frontend | SPA estático HTML/CSS/Vanilla JS em `backend/public/` |
| Auth | JWT (`jsonwebtoken`), bcrypt, OTP por email (Resend), OAuth PKCE parcial |
| Deploy | Vercel serverless via `api/index.ts` + standalone `backend/src/server.ts` |
| Testes | Node Test Runner nativo via `backend/scripts/collect-and-run-tests.mjs` |

**Ficheiros estruturais que vais tocar:**

```
backend/prisma/schema.prisma                              ← modelo de dados
backend/prisma/seed.ts                                    ← dados de arranque
backend/src/app.ts                                        ← builder Fastify, error handler, registo de rotas
backend/src/plugins/authenticate.ts                       ← plugin JWT, decora request.user / request.db
backend/src/database/prisma/tenantScopedClient.ts         ← extensão Prisma de isolamento multi-tenant
backend/src/modules/auth/services/AuthService.ts          ← OTP, password, super admin
backend/src/modules/auth/routes/auth.routes.ts
backend/src/modules/platform/controllers/ApplicationController.ts
backend/src/modules/platform/routes/platform.routes.ts
backend/src/modules/platform/routes/applications.routes.ts
backend/src/modules/crm/routes/crm.routes.ts
backend/src/modules/condominios/routes/condominios.routes.ts
backend/public/app.html                                   ← área do utilizador (hoje: página única)
backend/public/super-admin.html                           ← consola super admin
backend/public/login.html
```

**⚠️ AVISO SOBRE A DOCUMENTAÇÃO EXISTENTE:** os ficheiros em `docs/` (`AUDIT.md`, `Security.md`, `Architecture.md`, `FOUNDATION_CERTIFICATION.md`, etc.) descrevem funcionalidades que **não existem no código**: falam de Express, DI Container, EventBus, Helmet, CSP, rate limiting, refresh token rotation, bcrypt 12 rounds e "0 dívida técnica / 100 em 100". Nada disso está implementado. **Trata `docs/` como não-fiável.** A fonte de verdade é o código em `backend/src` e `backend/prisma/schema.prisma`. Uma das entregas desta tarefa é corrigir essa documentação (Fase 8).

---

## 1. REGRAS ABSOLUTAS

1. **Nunca executar** `prisma migrate reset`, `db push --force-reset` ou qualquer comando destrutivo contra a base de dados Neon (que é simultaneamente dev e produção). Todas as alterações de schema via `prisma migrate dev --name <nome_descritivo>`, revistas antes de aplicar.
2. **Não eliminar funcionalidade existente.** `index.html`, `login.html`, `app.html`, `super-admin.html`, CRM e Condomínios devem continuar a funcionar no fim de cada fase.
3. **Nunca commitar secrets.** `.env*` está no `.gitignore` — mantém assim. Não escrevas connection strings, chaves ou hosts reais em ficheiros de documentação (o `docs/PRODUCTION_AUDIT_RECOMMENDATIONS.md` atual expõe o host Neon — remove essa linha).
4. **TypeScript strict.** `npm run typecheck` tem de passar a zero erros no fim de cada fase.
5. **Uma fase = um conjunto coerente de commits.** Não misturar fases. Após cada fase: `npm run typecheck && npm test`, e só depois avançar.
6. **Não inventar modelos novos onde já existem.** O schema já tem `Module`, `ApplicationInstance`, `ApplicationAssignment`, `TenantSetting`, `AuditLog`, `Permission`, `RolePermission`. Estende-os; não cries um sistema paralelo.
7. **Pergunta antes de decidir** qualquer coisa que altere o contrato público da API ou o comportamento de login.

---

## 2. FASE 0 — CORREÇÕES DE SEGURANÇA BLOQUEANTES

**Esta fase é primeira e não negociável. A plataforma está publicada em `helderlabs.eu` com falhas que permitem acesso total de qualquer pessoa na internet. Não implementes nenhuma funcionalidade nova antes de isto estar fechado, testado e publicado.**

### 0.1 — `POST /api/auth/demo-login` emite um JWT de SUPER_ADMIN sem qualquer autenticação

`backend/src/modules/auth/routes/auth.routes.ts` expõe `/demo-login` sem `preHandler`. Chama `AuthService.demoLogin()`, que devolve um token assinado com `role: SUPER_ADMIN` para `helderguiomar@gmail.com`. Um único `POST` sem credenciais dá controlo total da plataforma e de todos os tenants.

**Correção:** eliminar `/demo-login` e `/demo-status` das rotas e os métodos `demoLogin()` / `demoStatus()` do `AuthService`. Se a demo for necessária para vendas, é reimplementada depois como tenant de demonstração isolado, com utilizador próprio, dados fictícios, `role: USER` e `NODE_ENV !== 'production'` obrigatório — nunca como super admin. Remover também qualquer referência em `backend/public/demo-button.html` e `login.html`.

### 0.2 — Código OTP mestre `123456` aceite em produção para qualquer conta

Em `AuthService.verifyOtp()`:

```ts
const isMasterCode = code === '123456';
const isDev = process.env.NODE_ENV !== 'production';
...
const isValidUserCode = isMasterCode || user.otpHash === code || isDev;
```

`isMasterCode` **não está condicionado ao ambiente**. Qualquer pessoa que conheça um email registado — incluindo o do super admin, que está publicado no `README.md` — entra com o código `123456`. O `|| isDev` agrava: em qualquer ambiente que não seja exatamente `production`, *qualquer* código é aceite.

**Correção:**

```ts
const allowMasterCode =
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_OTP === 'true';
const isValidUserCode = (allowMasterCode && code === '123456') || (await verifyOtpHash(code, user));
```

Aplicar a mesma correção ao ramo do `AccountRequest`, que tem o problema idêntico.

### 0.3 — OTP guardado em texto claro e validade nunca verificada

O campo chama-se `otpHash` mas recebe o código literal (`data: { otpHash: code }`). E `otpExpiresAt` é escrito mas **nunca comparado** em `verifyOtp` — um código continua válido indefinidamente.

**Correção:** guardar `await bcrypt.hash(code, 10)`, validar com `bcrypt.compare`, e rejeitar quando `user.otpExpiresAt < new Date()`. Adicionar contador `otpAttempts` e invalidar o código ao fim de 5 tentativas falhadas.

### 0.4 — Password por omissão do super admin em código-fonte

`ensureSuperAdminUser()` faz `bcrypt.hash('admin1234', 10)` e atribui essa password sempre que a conta não tiver uma. A password está no `README.md`, versionado no Git.

**Correção:** ler de `process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD`; se não estiver definida, criar a conta **sem** password (obrigando ao fluxo OTP). Nunca reatribuir password a uma conta que já tem. Remover as credenciais da tabela de "Demo Test Credentials" do `README.md`.

### 0.5 — Sem rate limiting em endpoints de autenticação

`/send-otp`, `/verify-otp` e `/login` aceitam pedidos ilimitados. Um OTP de 6 dígitos cai por força bruta em minutos.

**Correção:** `npm i @fastify/rate-limit`, registar em `app.ts` com limite global generoso e limite apertado (ex.: 5 pedidos / 15 min por IP+email) nos três endpoints acima.

### 0.6 — Sem cabeçalhos de segurança

Não existe Helmet nem CSP, ao contrário do que `docs/Security.md` afirma.

**Correção:** `npm i @fastify/helmet`, registar com CSP compatível com o SPA estático atual (verificar que as páginas continuam a renderizar antes de publicar).

### 0.7 — Verificação final da Fase 0

Escrever testes em `backend/tests/auth/` que provem:
- `/api/auth/demo-login` responde `404`;
- `verify-otp` com `123456` e `NODE_ENV=production` responde `401`;
- OTP expirado responde `401`;
- 6.ª tentativa consecutiva de `/login` responde `429`.

Depois: `npm run typecheck && npm test`, publicar (`npx vercel --prod --yes`) e **confirmar contra `https://helderlabs.eu` que `/api/auth/demo-login` já não emite token**. Só então avançar para a Fase 1.

---

## 3. ARQUITETURA-ALVO (o que estás a construir)

### 3.1 Três personas, três superfícies

| Persona | Quem | Superfície | Controla |
|---|---|---|---|
| **Super Admin** | HelderLabs (tu) | `/super-admin.html` | Que tenants existem, que apps licenciam, limites, planos, faturação, impersonation |
| **Admin de Tenant** | O cliente | `/workspace.html` → *Definições* | Utilizadores dele, papéis, branding, parâmetros — **dentro** do que a licença permite |
| **Utilizador final** | Colaborador do cliente | `/workspace.html` | Usa as apps a que foi atribuído |

Hoje só existem a primeira e a terceira, mal separadas. A segunda tem de nascer nesta tarefa: sem ela, o super admin fica a criar utilizadores à mão para cada cliente, o que não escala nem é vendável.

### 3.2 Princípio central: o manifesto de capacidades

O backend resolve o licenciamento uma vez por sessão e devolve um **manifesto**. O frontend desenha a interface a partir dele. **O manifesto desenha; o backend valida sempre.** Esconder um ícone não é segurança — é cortesia. Cada endpoint de módulo verifica o entitlement por si, em cada pedido.

### 3.3 O "ambiente de trabalho" — decisão de design

O objetivo é o utilizador entrar e ver, num relance, as aplicações que a empresa dele licenciou. **Não implementes um "webtop"** (ícones arrastáveis em coordenadas, janelas redimensionáveis, barra de tarefas): quebra deep links, quebra o botão "voltar", é inutilizável em mobile — e condomínios e rent-a-car são casos de uso móveis — e obriga a reimplementar um gestor de janelas dentro do browser.

Implementa um **app launcher**: grelha de cartões na entrada, e cada aplicação abre em página própria com rota real e URL partilhável. É o padrão do Odoo, do Google Workspace e do Microsoft 365, e dá a mesma sensação a uma fração do custo.

---

## 4. FASE 1 — MODELO DE DADOS

Alterações a `backend/prisma/schema.prisma`. Uma migração por bloco coerente, com nome descritivo.

### 4.1 `Module`: chave estável separada do nome

Hoje `Module.name` é `@unique` e é usado como identidade. Renomear um módulo para efeitos de UI parte o sistema.

```prisma
model Module {
  id          String  @id @default(cuid())
  key         String  @unique          // "crm", "condominios", "rentacar" — identidade técnica, imutável
  name        String                    // rótulo de UI, editável
  description String?
  icon        String?                   // nome do ícone para o launcher
  color       String?                   // cor do cartão
  category    String  @default("Geral")
  sortOrder   Int     @default(100)
  isActive    Boolean @default(true)    // switch global da plataforma
  ...
}
```

Migração de dados: preencher `key` a partir do `name` atual em minúsculas sem acentos. Substituir todos os usos de `name` como identificador por `key`.

### 4.2 `ApplicationInstance` passa a ser o entitlement

Não cries uma tabela nova de licenças. Estende a que já existe:

```prisma
model ApplicationInstance {
  // ... campos atuais mantidos ...
  status      ApplicationStatus @default(TRIAL)

  plan        String?           // "base" | "pro" | "enterprise"
  features    String[]          @default([])   // features ativas dentro do módulo
  limits      Json              @default("{}") // { "contactos": 5000, "edificios": 20 }
  validFrom   DateTime?
  validUntil  DateTime?         // null = sem termo
  graceDays   Int               @default(7)
  suspendedAt DateTime?
  suspendedReason String?
}
```

Acrescentar dois estados ao enum, porque um módulo licenciado tem mais do que ligado/desligado:

```prisma
enum ApplicationStatus {
  DISABLED
  TRIAL
  ACTIVE
  GRACE       // expirou, dentro do período de tolerância — ainda escreve, com aviso
  SUSPENDED   // não pagamento — só leitura e exportação
  ARCHIVED
}
```

### 4.3 Resolver a duplicação `TenantModule` vs `ApplicationInstance`

`TenantModule` (`tenantId + moduleId + isActive`) e `ApplicationInstance` (`tenantId + moduleId + status`) representam a mesma coisa, com respostas potencialmente contraditórias. `TenantModule` não é lido em lado nenhum do código.

**Ação:** migrar quaisquer registos de `TenantModule` para `ApplicationInstance` e remover o modelo `TenantModule` e a relação em `Tenant`. Documenta a remoção no `CHANGELOG.md`.

### 4.4 Personalização da empresa — `TenantBranding`

O `TenantSetting` genérico (`key`/`value` em string) não serve para isto: não é tipado, não é validável e obriga a `N` queries. Modelo dedicado:

```prisma
model TenantBranding {
  id              String   @id @default(cuid())
  tenantId        String   @unique
  tenant          Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Identidade visual
  logoUrl         String?
  logoDarkUrl     String?
  faviconUrl      String?
  primaryColor    String   @default("#0d419f")
  accentColor     String   @default("#0d419f")
  theme           String   @default("system")   // light | dark | system

  // Identidade comercial
  displayName     String?                        // nome comercial, se diferente do legal
  legalName       String?
  taxNumber       String?                        // NIF
  addressLine     String?
  postalCode      String?
  city            String?
  country         String   @default("PT")

  // Parâmetros operacionais
  locale          String   @default("pt-PT")
  timezone        String   @default("Atlantic/Madeira")
  currency        String   @default("EUR")
  dateFormat      String   @default("dd/MM/yyyy")
  vatRate         Float    @default(23)
  fiscalYearStart Int      @default(1)           // mês

  // Comunicação
  emailFromName   String?
  emailFromAddress String?
  emailFooter     String?
  supportEmail    String?
  supportPhone    String?

  updatedAt       DateTime @updatedAt
  updatedBy       String?

  @@map("tenant_branding")
}
```

**Regra:** `primaryColor`, `accentColor` e URLs são validados no backend com Zod (hex `^#[0-9a-fA-F]{6}$`, URL http/https) antes de serem gravados. São injetados no HTML como **CSS custom properties**, nunca por interpolação de string em `<style>` sem validação — caso contrário abres XSS ao próprio admin do tenant.

Quem pode editar o quê: o **admin do tenant** edita branding, contactos e parâmetros operacionais; **só o super admin** edita `legalName`, `taxNumber` e qualquer campo que afete faturação.

### 4.5 Impersonation auditada

```prisma
model ImpersonationSession {
  id              String    @id @default(cuid())
  actorUserId     String                        // o super admin
  actorEmail      String
  targetTenantId  String
  targetUserId    String?
  reason          String                        // obrigatório
  writeEnabled    Boolean   @default(false)     // leitura por omissão
  startedAt       DateTime  @default(now())
  expiresAt       DateTime                      // startedAt + 30 min
  endedAt         DateTime?
  ipAddress       String?

  @@index([actorUserId])
  @@index([targetTenantId])
  @@map("impersonation_sessions")
}
```

### 4.6 `AuditLog` — corrigir e encadear

Problemas atuais: `oldValue`/`newValue` são `String` (deviam ser `Json`), não há `prevHash`/`hash` apesar de a auditoria com hash ser um requisito do projeto, e **o modelo não é escrito em lado nenhum do código** — está declarado e nunca usado.

```prisma
model AuditLog {
  id            String   @id @default(cuid())
  seq           BigInt   @default(autoincrement())   // ordem determinística
  actorId       String?
  actorEmail    String?
  actorType     String?                              // USER | SUPER_ADMIN | SYSTEM
  onBehalfOfId  String?                              // preenchido durante impersonation
  impersonationId String?
  tenantId      String?
  action        String                               // "application.status.changed"
  resource      String?
  resourceId    String?
  oldValue      Json?
  newValue      Json?
  requestId     String?
  ipAddress     String?
  userAgent     String?
  result        String?
  timestamp     DateTime @default(now())
  prevHash      String?
  hash          String                               // SHA-256 do payload + prevHash

  @@index([tenantId, timestamp])
  @@index([actorId])
  @@map("audit_logs")
}
```

O encadeamento (`hash_n = SHA256(hash_{n-1} || payload_canónico)`) torna detetável a adulteração de qualquer registo do histórico, não apenas de um registo isolado — é o argumento que vendes a um cliente com requisitos de compliance. Implementa uma função `verifyAuditChain(tenantId?)` e expõe-a na consola de super admin.

---

## 5. FASE 2 — RESOLUÇÃO DE ENTITLEMENTS E MANIFESTO

Criar `backend/src/modules/platform/services/EntitlementService.ts`.

### 5.1 Resolução

```ts
type AppEntitlement = {
  key: string;                 // module.key
  name: string;
  icon: string | null;
  color: string | null;
  state: 'ACTIVE' | 'TRIAL' | 'GRACE' | 'SUSPENDED' | 'DISABLED' | 'NONE';
  writable: boolean;           // false em SUSPENDED
  features: string[];
  limits: Record<string, number>;
  usage: Record<string, number>;
  daysLeft: number | null;
  roleInApp: string | null;    // null se o utilizador não estiver atribuído
  permissions: string[];
};

resolveForUser(userId, tenantId): Promise<WorkspaceManifest>
```

Cascata determinística, num único sítio do código:

```
default do módulo → plano → features do entitlement → override do tenant → preferência do utilizador
```

Regras de estado:
- `validUntil` no passado e dentro de `graceDays` → `GRACE` (escreve, com aviso)
- `validUntil` no passado e fora de `graceDays` → `SUSPENDED` (`writable: false`)
- `suspendedAt` preenchido → `SUSPENDED`
- `Module.isActive === false` → `DISABLED` para todos os tenants
- Sem `ApplicationInstance` → `NONE`

**Nunca cortes o acesso por não pagamento.** Sequência: aviso in-app → grace → só leitura com exportação disponível → arquivo. Um cliente que perde acesso aos dados torna-se um problema jurídico; em modo leitura é apenas um pagamento atrasado.

### 5.2 Endpoint do manifesto

`GET /api/me/workspace` (autenticado, qualquer role):

```json
{
  "version": 47,
  "issuedAt": "2026-09-06T18:00:00Z",
  "expiresAt": "2026-09-06T18:15:00Z",
  "user": { "id": "...", "name": "...", "email": "...", "role": "TENANT_ADMIN" },
  "tenant": { "id": "...", "name": "...", "slug": "...", "status": "ACTIVE" },
  "branding": { "logoUrl": "...", "primaryColor": "#0d419f", "locale": "pt-PT", "currency": "EUR", "timezone": "Atlantic/Madeira" },
  "apps": [ /* AppEntitlement[] — incluindo os NONE, para upsell */ ],
  "impersonation": null
}
```

- `version` é um contador incrementado sempre que muda o licenciamento do tenant (guardar em `Tenant.entitlementsVersion Int @default(1)`). O frontend compara-o com o que tem em memória e recarrega quando diverge — é assim que uma alteração de licença feita por ti tem efeito imediato no cliente.
- **Não metas entitlements dentro do JWT.** Ficariam presos até expirar e revogar uma licença deixaria de ser imediato. O JWT continua a transportar apenas `sub`, `tenantId`, `role`, `email`.
- Cache em memória com TTL curto (60s) invalidado por `version`.

### 5.3 Preparação para o modo offline

O projeto prevê fallback offline. O manifesto tem de ser assinado (HMAC com `JWT_SECRET`) e ter `expiresAt` + tolerância offline configurável. Sem isto, o modo offline é um buraco de licenciamento: basta desligar a rede para usar módulos não pagos indefinidamente. Nesta fase implementa a assinatura e a validação; a sincronização offline completa fica fora do âmbito.

---

## 6. FASE 3 — ENFORCEMENT NO BACKEND

**Esta é a fase que fecha o buraco de segurança funcional atual: hoje `/api/crm/*` e `/api/condominios/*` verificam apenas o JWT. Um utilizador de um tenant que nunca licenciou o CRM chama `/api/crm/leads` e é servido normalmente. Todo o sistema de licenciamento existe apenas na UI.**

Criar `backend/src/plugins/entitlements.ts`, no padrão do `authenticate.ts` (`fastify-plugin`, decoradores):

```ts
app.decorate('requireApp', (moduleKey: string, opts?: { write?: boolean }) => preHandler)
app.decorate('requirePermission', (permission: string) => preHandler)
```

Comportamento de `requireApp('crm')`:
1. Corre depois de `app.authenticate`.
2. Lê o manifesto resolvido (cacheado) para `request.user.tenantId`.
3. `state === 'NONE' | 'DISABLED'` → `403 { error: 'APP_NOT_LICENSED' }`
4. `state === 'SUSPENDED'` e o método não é `GET` → `403 { error: 'APP_READ_ONLY' }`
5. `roleInApp === null` → `403 { error: 'APP_NOT_ASSIGNED' }`
6. Limite excedido numa operação de criação → `403 { error: 'LIMIT_EXCEEDED', limit, current }`
7. Decora `request.entitlement` para os services consultarem features e limites.

Aplicar:

```ts
// crm.routes.ts
app.addHook('preHandler', app.authenticate);
app.addHook('preHandler', app.requireApp('crm'));

// condominios.routes.ts
app.addHook('preHandler', app.authenticate);
app.addHook('preHandler', app.requireApp('condominios'));
```

**Exceção a preservar:** `POST /api/crm/leads` aceita hoje submissões públicas não autenticadas vindas do formulário da landing page. Essa rota tem de ficar **fora** do guard — extrai-a para `POST /api/public/leads` com rate limiting próprio e sem qualquer relação com o guard de entitlements.

Acrescentar códigos de erro ao error handler unificado de `app.ts`, mantendo a regra de "um só `setErrorHandler`".

---

## 7. FASE 4 — ÁREA DO UTILIZADOR (LAUNCHER + SHELL)

### 7.1 Novo `backend/public/workspace.html`

Substitui `app.html` como ponto de entrada após login. Mantém `app.html` a funcionar durante a transição (redireciona no fim da fase).

Estrutura:

```
┌──────────────────────────────────────────────────────────┐
│ [logo do tenant]   Consultoria Alfa    [⌘K]    👤 Hélder │
├──────────────────────────────────────────────────────────┤
│  Bom dia, Hélder                                         │
│                                                          │
│  AS MINHAS APLICAÇÕES                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                     │
│  │  CRM    │ │Condomín.│ │Rent-a-  │                     │
│  │ ● Ativo │ │ ● Ativo │ │Car      │                     │
│  │3 tarefas│ │2 avisos │ │⏱ 12 dias│                     │
│  └─────────┘ └─────────┘ └─────────┘                     │
│                                                          │
│  DISPONÍVEL COM UPGRADE                                  │
│  ┌─────────┐ ┌─────────┐                                 │
│  │Faturação│ │Financeir│   [Solicitar acesso]            │
│  │   🔒    │ │   🔒    │                                 │
│  └─────────┘ └─────────┘                                 │
└──────────────────────────────────────────────────────────┘
```

Requisitos:

1. **Fonte de dados única:** um `GET /api/me/workspace` no arranque. Nada de chamadas especulativas a `/api/crm/*` e `/api/condominios/*` como faz o `app.html` atual (que carrega tudo de todos os módulos independentemente do licenciamento).
2. **Cartão com estado vivo:** badge de pendências, dias de trial restantes, aviso de limite (`4.800 / 5.000 contactos`). Um ícone que não diz nada é um ícone que ninguém volta a olhar.
3. **Estados visuais distintos:** ativo, trial (com contagem), grace (aviso âmbar), suspenso (cinzento, "só leitura"), bloqueado (cadeado + upsell).
4. **Apps `NONE` visíveis como upsell** com botão *Solicitar acesso* → cria um `AccessRequest` notificado ao admin do tenant e a ti. Configurável por tenant em `TenantBranding` (`showUpsell: boolean`), porque alguns clientes vão preferir esconder.
5. **Personalização controlada:** o utilizador fixa favoritos, reordena os cartões e define a app de arranque. Guardar em `UserPreference` (`userId`, `key`, `value Json`). É esta a parte do "ambiente de trabalho" que as pessoas realmente valorizam — não as janelas arrastáveis.
6. **Branding aplicado:** injetar `primaryColor`, `accentColor`, `logoUrl` como CSS custom properties no `:root`, a partir do manifesto. Nunca por interpolação direta de string não validada.
7. **Rotas reais:** `/workspace.html#/crm/leads` ou, melhor, páginas próprias por app. URL partilhável e botão "voltar" funcional são requisitos, não extras.
8. **`Ctrl+K` / `⌘K`** para pesquisa e salto entre apps.
9. **Responsivo.** A grelha colapsa para uma coluna em mobile. Condomínios e rent-a-car são usados no terreno.

### 7.2 Contrato de módulo

Para que adicionar a 4.ª app não obrigue a tocar em 15 sítios, cada módulo regista-se num descritor único:

```ts
// backend/src/modules/<mod>/module.manifest.ts
export const manifest: ModuleManifest = {
  key: 'crm',
  name: 'CRM',
  icon: 'users',
  color: '#0d419f',
  routePrefix: '/api/crm',
  frontendEntry: '/apps/crm.html',
  permissions: ['crm.lead.read', 'crm.lead.write', 'crm.opportunity.manage'],
  features: ['pipeline', 'email_sync'],
  defaultLimits: { contactos: 1000 },
  configSchema: z.object({ currency: z.string().default('EUR'), leadSources: z.array(z.string()) })
};
```

O launcher, o menu, a consola de super admin e o seeder leem deste registo. **Cria o descritor para os módulos existentes (`crm`, `condominios`) nesta fase** — é o padrão que os módulos futuros vão seguir, e se nascer torto arrasta-se para sempre.

### 7.3 Área de administração do tenant

Dentro de `workspace.html`, visível apenas a `TENANT_OWNER` / `TENANT_ADMIN`:

- **Utilizadores** — convidar por email, atribuir apps e `roleInApp`, suspender. Sem passar por ti.
- **Identidade da empresa** — logo, cores, nome comercial, contactos, morada.
- **Parâmetros** — moeda, IVA, fuso, formato de data, idioma.
- **Configuração por app** — o `configSchema` de cada módulo, renderizado a partir do descritor.
- **Faturação** — plano atual, limites, consumo, faturas (leitura).

Tudo limitado ao que a licença permite: um tenant sem o módulo Faturação não vê o separador.

---

## 8. FASE 5 — CONSOLA DE SUPER ADMINISTRAÇÃO

Reescrever `backend/public/super-admin.html`, preservando as abas atuais que funcionam.

### 8.1 Separação control plane / data plane

Hoje o super admin é um `UserRole` dentro da mesma tabela `users`, no tenant `helderlabs-platform`, e as rotas de plataforma usam o `prisma` global, contornando o `tenantScopedClient`. Isto significa que uma escalada de privilégios num módulo de cliente é um caminho direto para a consola que controla todos os tenants.

**Nesta fase, no mínimo:**
- Tokens de super admin com `aud: 'platform-admin'`; tokens de tenant com `aud: 'tenant'`. Um não é aceite onde o outro é esperado.
- Sessão de super admin com TTL curto (1h, não 8h) e MFA obrigatório (TOTP) — implementar nesta fase ou registar como bloqueio explícito com data.
- Todas as leituras e escritas do control plane auditadas, incluindo consultas a dados de cliente (RGPD).

Se preferires, isto pode evoluir depois para tabela de identidade e aplicação separadas (`admin.helderlabs.eu`). Regista a decisão em `docs/Architecture.md`.

### 8.2 Ecrãs

**Lista de tenants** — nome, estado, plano, nº utilizadores ativos, apps licenciadas, último acesso, alertas.

**Detalhe do tenant**, por separadores:

| Separador | Conteúdo |
|---|---|
| **Licenças** | Apps do catálogo com toggle de estado, plano, features, `validUntil`, trial, add-ons. Cada alteração incrementa `entitlementsVersion` e escreve no `AuditLog`. |
| **Limites** | Limites definidos **com consumo atual ao lado** (`3.240 / 5.000`) — é assim que sabes quando fazer upsell |
| **Utilizadores** | Lista, papéis, atribuições por app, convites pendentes, **aprovação em 1 clique** dos `PENDING_APPROVAL` com atribuição de tenant no mesmo modal |
| **Identidade** | Branding e parâmetros; campos fiscais editáveis só aqui |
| **Faturação** | Plano, valor, estado de pagamento, ação "suspender / reativar" |
| **Auditoria** | `AuditLog` filtrado por este tenant, com verificação da cadeia de hash |
| **Saúde** | Erros recentes, jobs falhados, estado da sincronização offline, conflitos por resolver |

**Catálogo** — módulos, features, planos, matriz plano × feature. Define-se o produto aqui, não o cliente.

**Feature flags** — ativar algo para um tenant específico antes do lançamento geral.

**Provisionamento** — assistente: criar tenant → escolher plano → aplicar seed → convidar admin → email de boas-vindas.

**Auditoria global** e **Anúncios** (banner in-app por tenant ou global).

### 8.3 Impersonation

Fluxo obrigatório:

1. Super admin clica *Entrar como* num tenant → modal exige **motivo** (texto livre, obrigatório) e escolha entre *só leitura* (por omissão) e *leitura e escrita*.
2. Cria `ImpersonationSession` com `expiresAt = now + 30min`.
3. Emite JWT distinto com `impersonationId`, `actingTenantId`, `actingUserId`, `aud: 'tenant'`, TTL igual ao da sessão.
4. `authenticate.ts` passa a resolver o tenant efetivo a partir de `actingTenantId` quando presente — é aqui que o `forTenant()` muda de contexto, e o único sítio onde isso é permitido.
5. **Banner permanente e visualmente agressivo** no topo enquanto durar, com botão *Terminar sessão de suporte*.
6. Em modo leitura, qualquer método não-`GET` é rejeitado com `403 IMPERSONATION_READ_ONLY`.
7. Todos os registos de `AuditLog` gravados nesse período levam `actorId` (tu) **e** `onBehalfOfId` — para nunca haver dúvida sobre se foi o cliente ou tu.
8. `endedAt` preenchido ao terminar ou ao expirar.

---

## 9. FASE 6 — AUDITORIA EFETIVA

Criar `backend/src/modules/platform/services/AuditService.ts` e ligá-lo de facto (hoje o modelo existe e nunca é escrito).

- `audit(ctx, { action, resource, resourceId, oldValue, newValue })`
- Hook Fastify `onResponse` que audita automaticamente todos os métodos não-`GET` em `/api/platform/*` e as ações de licenciamento.
- Escrita **não pode bloquear** a resposta ao utilizador nem, se falhar, fazer falhar a operação — mas uma falha de escrita de auditoria tem de ser registada no log de aplicação com severidade `error`.
- Encadeamento de hash por tenant (`prevHash` = hash do último registo desse tenant), com serialização canónica determinística do payload.
- `verifyAuditChain()` exposto na consola.
- Retenção configurável; nunca apagar sem política definida.

---

## 10. FASE 7 — TESTES

Escrever em `backend/tests/` (Node Test Runner, padrão dos testes existentes, com fakes no estilo de `tests/crm/support/fakePrismaClient.ts`).

**Segurança (Fase 0):** os quatro testes já indicados em 2.7.

**Entitlements:**
- tenant sem CRM → `GET /api/crm/leads` responde `403 APP_NOT_LICENSED`
- tenant com CRM `SUSPENDED` → `GET` passa, `POST` responde `403 APP_READ_ONLY`
- utilizador do tenant sem `ApplicationAssignment` → `403 APP_NOT_ASSIGNED`
- `validUntil` expirado dentro do grace → estado `GRACE`, escrita permitida
- `validUntil` expirado fora do grace → estado `SUSPENDED`
- criação que excede `limits` → `403 LIMIT_EXCEEDED`
- alterar licença incrementa `entitlementsVersion`

**Isolamento:** utilizador do tenant A não lê nem escreve dados do tenant B, em todos os módulos.

**Impersonation:** sessão em modo leitura rejeita `POST`; sessão expirada rejeita tudo; registos de auditoria trazem `onBehalfOfId`.

**Auditoria:** cadeia de hash válida após N escritas; adulteração de um registo intermédio é detetada por `verifyAuditChain`.

**Branding:** cor inválida rejeitada com `400`; `<script>` em campo de texto não chega ao HTML renderizado.

Manter os testes atuais a passar. Alvo mínimo: **cobertura total dos caminhos de autorização** — é aí que uma falha custa clientes.

---

## 11. FASE 8 — VERIFICAÇÃO E RELATÓRIO

### 11.1 Validação funcional

Correr localmente (`npm run dev`) e percorrer, com capturas de ecrã:

1. Login como `TENANT_ADMIN` da Consultoria Alfa → `workspace.html` mostra CRM ativo, Finance em trial, restantes bloqueados
2. Super admin desativa o CRM da Alfa → recarregar o workspace do utilizador: cartão passa a bloqueado **e** `GET /api/crm/leads` responde `403`
3. Super admin muda logo e cor primária da Alfa → workspace reflete
4. Impersonation em modo leitura → banner visível, `POST` bloqueado, auditoria com `onBehalfOfId`
5. Admin do tenant convida utilizador e atribui só o CRM → esse utilizador não vê Condomínios
6. Testar em viewport de telemóvel

### 11.2 Correção da documentação

- Reescrever `docs/Architecture.md` e `docs/Security.md` para descreverem o sistema **real**
- Marcar `docs/AUDIT.md`, `docs/FOUNDATION_CERTIFICATION.md` e restantes relatórios de "100/100" como históricos ou eliminá-los — afirmam funcionalidades inexistentes e são perigosos como referência
- Remover o host da base de dados Neon de `docs/PRODUCTION_AUDIT_RECOMMENDATIONS.md`
- Remover as credenciais de demonstração do `README.md`
- Atualizar `CLAUDE.md` com o modelo de entitlements, o contrato de módulo e a regra de que **todo o endpoint de módulo tem de passar por `requireApp`**
- Atualizar `CHANGELOG.md`

### 11.3 Relatório final

Entrega um relatório com:

1. **Alterações por fase** — ficheiros criados, modificados, removidos
2. **Migrações aplicadas** — nome, o que fazem, se são reversíveis
3. **Vulnerabilidades corrigidas** — cada uma, como foi corrigida, teste que a cobre
4. **Testes** — quantos, quais passam, cobertura das rotas de autorização
5. **Problemas encontrados e não resolvidos** — com justificação
6. **Dívida técnica criada** — o que ficou por fazer bem, e porquê
7. **Riscos em aberto** — em particular tudo o que fique dependente de decisão tua
8. **Recomendações para a fase seguinte**

---

## 12. FORA DO ÂMBITO (não implementar sem pedido explícito)

- Módulo rent-a-car (só o registo no catálogo, sem implementação)
- Gateway de pagamentos e faturação automática
- SAF-T PT
- Sincronização offline completa (só a assinatura do manifesto)
- Migração do frontend para framework — mantém-se vanilla JS nesta tarefa
- Subdomínio próprio por tenant

---

## 13. ORDEM DE EXECUÇÃO — RESUMO

```
FASE 0  Segurança bloqueante        → typecheck + testes + DEPLOY IMEDIATO
FASE 1  Modelo de dados             → migrações + seed
FASE 2  EntitlementService + manifesto
FASE 3  Guards no backend           → enforcement real
FASE 4  workspace.html + branding + admin do tenant
FASE 5  Consola super admin + impersonation
FASE 6  Auditoria com hash chain
FASE 7  Testes
FASE 8  Verificação visual + documentação + relatório
```

Não avances de fase com `npm run typecheck` ou `npm test` a falhar. Se uma fase revelar que a especificação está errada, **para e diz** — não contornes.
