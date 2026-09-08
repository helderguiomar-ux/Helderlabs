# PROMPT DE EXECUÇÃO — ANTIGRAVITY
## HELDERLABS ERP · Dois módulos novos
### **HCCALL Telecom** (`hccall`) · **2SELLMAIS** (`sellmais`)

> **Diretoria canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Alvo:** v0.5.0 · **Documento escrito a partir do estado real do repositório**
> Complementa — não substitui — `AGENTS.md`, `CLAUDE.md`, `DECISOES.md`, `qa/CONTRATO.md` e `docs/PROMPT_ANTIGRAVITY_FIN_CRM.md`.

---

## COMO LER ESTE DOCUMENTO

| Parte | Conteúdo | Aplica-se a |
| :--- | :--- | :--- |
| **I** | A hierarquia do HelderLabs ERP e as regras transversais | Ambos os módulos |
| **II** | HCCALL Telecom — especificação completa | `hccall` |
| **III** | 2SELLMAIS — especificação completa | `sellmais` |
| **IV** | Ordem de execução, testes e entregáveis | Ambos |

A Parte I é obrigatória e **não se repete** nas Partes II e III. Tudo o que lá está aplica-se aos dois módulos sem exceção.

---
---

# PARTE I — A HIERARQUIA DO HELDERLABS ERP

## I.1 As cinco camadas

Nenhum módulo novo inventa infraestrutura. Encaixa nesta hierarquia, que já existe e funciona:

```
1. PLATAFORMA                 Module (catálogo global de módulos)
   │                          SUPER_ADMIN / PLATFORM_ADMIN gerem tudo
   │
2. TENANT                     Tenant + TenantBranding + TenantSetting
   │                          A empresa cliente. Fronteira absoluta de dados.
   │
3. LICENÇA                    ApplicationInstance (tenant × módulo)
   │                          estado, plano, validFrom/validUntil, graceDays,
   │                          features, limits, preço
   │
4. ATRIBUIÇÃO                 ApplicationAssignment (utilizador × licença)
   │                          roleInApp, estado
   │
5. MÓDULO                     As tuas entidades, todas com tenantId
                              protegidas por requireApp() + requirePermission()
```

Consequências que não se discutem:

- **O tenant vem sempre de `request.user.tenantId`.** Nunca de query, body ou header.
- **Nenhuma rota de módulo sem `app.authenticate` + `app.requireApp('<chave>')`.** O módulo financeiro esqueceu-se disto em 7 ficheiros de rotas e ficou aberto a qualquer utilizador autenticado de qualquer empresa. Não repetir.
- **Nenhum acesso a `prisma` cru fora de `tenantScopedClient.ts`** (ADR 001).
- **Todo o modelo novo com `tenantId` entra em `TENANT_SCOPED_MODELS`** no `tenantScopedClient.ts`, na mesma alteração em que é criado. Esquecer isto abre uma fuga entre tenants.

## I.2 Correções ao briefing — ler antes de planear

O briefing do HCCALL contém três pressupostos técnicos errados sobre este repositório. Corrigidos aqui para não gerarem trabalho perdido:

| No briefing | Realidade deste repositório |
| :--- | :--- |
| "PostgreSQL/Drizzle existente" | **Não há Drizzle. É Prisma 5.** Não introduzas um segundo ORM. |
| "aproveitar Row-Level Security se já implementado" | **RLS não está ativo.** Está documentado em `docs/DIVIDA_TECNICA.md` (DT-01): a aplicação liga-se como dono das tabelas, e o PostgreSQL ignora políticas RLS para o dono. O isolamento real é a Prisma Client Extension `tenantScopedClient.ts`. Usa-a. Não assumas RLS. |
| "Não criar perfis de supervisor ou administrador" | Ver §I.3 — é conciliável, mas não como está escrito. |

## I.3 O conflito "utilizador único" vs hierarquia — resolvido assim

O briefing pede que o HCCALL não tenha supervisor nem administrador. A intenção é boa: **dentro da ferramenta não há hierarquia**. Mas a plataforma por cima **tem de ter**, porque alguém licencia o módulo, cria utilizadores e paga. Não são a mesma coisa.

**Decisão fixada:**

- **Dentro do módulo `hccall` existe um único papel funcional:** `hccall.user`. Sem supervisor, sem gestor, sem permissões diferenciadas entre operadores. A interface não mostra nada de administração.
- **A camada da plataforma mantém-se intacta:** `TENANT_OWNER` / `TENANT_ADMIN` gerem licenças e utilizadores em `workspace.html` e `super-admin.html`, **fora** do HCCALL.
- Um operador que seja o dono do próprio negócio é simplesmente o mesmo utilizador com os dois papéis — não é um problema, é o caso normal de um vendedor independente.

**E resolve-se aqui uma omissão do briefing que ia dar problema:**

O briefing diz que os dados de um tenant nunca são visíveis por outro, mas **não diz nada sobre visibilidade entre utilizadores do mesmo tenant**. Num call center com vinte operadores, as vendas e as comissões são **pessoais**. Se todos virem tudo, o produto é inutilizável — e se ninguém vir nada, uma loja com dois vendedores não consegue fechar o mês.

Logo: **toda a entidade operacional do HCCALL tem `ownerUserId`**, e o âmbito de leitura é decidido por definição do tenant:

```
TenantSetting  hccall.visibility  =  OWN (por omissão)  |  TEAM
```

`OWN` filtra por `ownerUserId = request.user.sub`. `TEAM` mostra o tenant inteiro. É uma linha no serviço de âmbito, escrita **uma vez**, e nunca replicada controller a controller.

## I.4 Hierarquia de ficheiros de um módulo

```
backend/
├── prisma/
│   ├── schema.prisma                      ← modelos novos (migração aditiva)
│   ├── migrations/<timestamp>_add_<chave>/
│   └── seed.ts                            ← linha em `modules` + dados de exemplo
├── src/
│   ├── app.ts                             ← app.register(<chave>Routes, { prefix: '/api/<chave>' })
│   ├── database/prisma/tenantScopedClient.ts   ← TENANT_SCOPED_MODELS += modelos novos
│   └── modules/<chave>/
│       ├── module.manifest.ts             ← key, name, rotas, permissões, features, limits
│       ├── routes/<chave>.routes.ts       ← authenticate + requireApp + requirePermission
│       ├── controllers/…                  ← só HTTP: validar, chamar serviço, responder
│       └── services/…                     ← TODA a lógica de negócio e cálculos
├── public/
│   ├── app.html            ← vista do módulo (desktop) — ver exceção do HCCALL em II.2
│   ├── assets/js/modules.js ← entrada em window.MODULES_REGISTRY
│   └── locales/pt.json + en.json          ← paridade 1:1 obrigatória
└── tests/<chave>/…                        ← testes do módulo
```

## I.5 Checklist de registo de um módulo — os 10 passos

Faz os dez. Falhar um deles produz um módulo que "funciona" em dev e não aparece em produção.

1. `module.manifest.ts` com `key`, `name`, `icon`, `color`, `routePrefix`, `frontendEntry`, `permissions[]`, `features[]`, `defaultLimits{}`.
2. Linha em `seed.ts` → tabela `Module`, com **exatamente a mesma `key`** do manifesto.
3. Registo das rotas em `app.ts` com o prefixo do manifesto.
4. `app.authenticate` + `app.requireApp('<chave>')` em **todas** as rotas do módulo.
5. Permissões do módulo criadas em `Permission` e ligadas aos perfis em `RolePermissionLink`.
6. Modelos novos acrescentados a `TENANT_SCOPED_MODELS`.
7. Entrada em `window.MODULES_REGISTRY` (`assets/js/modules.js`), com `key`, nome pt/en, `status`, `route`, `icon`, `licensable`.
8. Chaves de tradução em `locales/pt.json` **e** `locales/en.json` — há um teste de paridade (`tests/public/translationParity.test.ts`) que falha se faltar uma.
9. Migração Prisma **aditiva**, gerada com `npm run db:migrate -- --name add_<chave>`.
10. Testes em `backend/tests/<chave>/`, incluindo isolamento entre tenants.

> ⚠️ **Uma chave, um sítio.** O módulo financeiro ficou com `financas` no manifesto e `finance` no `seed.ts`, e só não parte por causa de um alias hardcoded no `requireApp`. Isso é dívida, não padrão. As chaves novas são **`hccall`** e **`sellmais`**, escritas assim em todo o lado.

> ⚠️ **`2SELLMAIS` é nome comercial, não chave técnica.** Um identificador começado por dígito parte em sítios concretos: `#2sellmais` é seletor CSS inválido (e o `app.html` usa `document.querySelector('#view-…')`), e `manifest.apps.2sellmais` é erro de sintaxe em JS. Chave: **`sellmais`**. Nome mostrado: **2SELLMAIS**.

## I.6 Regras absolutas

1. **Fase 0 primeiro.** Auditoria e plano escrito antes de qualquer linha de código, para os dois módulos.
2. **NADA É APAGADO.** Sem `DROP`, sem `migrate reset`, sem `db push --accept-data-loss`. Eliminação é sempre lógica (`deletedAt`).
3. **Migrações aditivas e reversíveis.** Colunas novas anuláveis ou com `DEFAULT`. Nunca renomear coluna em uso.
4. **Backup lógico antes de migrar**, com verificação de que o ficheiro tem tamanho > 0 — o `backup-pre-migracoes-2026-09-07.dump` tem 0 bytes e ninguém reparou.
5. **`guard-db.mjs` não se contorna.** Dev e migrações dev só contra `localhost`.
6. **Toda a escrita relevante regista `AuditService`** (cadeia SHA-256 já existente).
7. **`cd backend && npm run verify` verde** antes e depois de cada fase.
8. **O código é a fonte da verdade.** Se um `.md` contradisser o código, o código ganha e o `.md` corrige-se. Vários ficheiros de documentação deste repositório descrevem funcionalidades que não existem — não acredites neles, e ao registar os módulos novos em `modules.js` a lista `ready` só menciona o que **está feito**.

## I.7 Dinheiro, datas e identificadores — regras comuns

- **Todo o valor monetário é `Int` em cêntimos.** Zero `Float`. É o ponto 12 do `qa/CONTRATO.md` e o módulo financeiro já está assim.
- **Toda a restrição de unicidade inclui `tenantId`.** `@@unique([tenantId, code])`, nunca `@unique` isolado — o `invoiceNumber` global do financeiro impedia dois tenants de usarem o mesmo número de fatura.
- **Toda a numeração sequencial usa contador atómico por tenant**, incrementado na mesma transação com `UPDATE … RETURNING`. `count(*) + 1` gera duplicados assim que houver dois utilizadores em simultâneo.
- **Todas as entidades têm `deletedAt`** e todas as leituras filtram `deletedAt: null`.

## I.8 A checklist dos erros que não se repetem

Cada linha foi um defeito real encontrado neste repositório. Verifica-a em ambos os módulos antes de dar uma fase por concluída.

- [ ] `authenticate` **e** `requireApp` em todas as rotas.
- [ ] Zero `prisma` cru; tudo via `forTenant()`.
- [ ] Todos os modelos em `TENANT_SCOPED_MODELS`.
- [ ] Zero `delete` físico.
- [ ] Zero `Float` em dinheiro.
- [ ] Unicidade sempre com `tenantId`.
- [ ] Nenhum GET com efeito secundário (o `listCategories` financeiro semeia dados num GET).
- [ ] Nenhuma listagem sem paginação (máx. 200 por página).
- [ ] Dashboard com ≤ 4 queries; séries temporais por `GROUP BY`, não 12 agregações em ciclo.
- [ ] Zod estrito em todos os endpoints; **zero `as any`**; input inválido → 400 com os valores aceites, nunca um valor "adivinhado" por omissão.
- [ ] Uma só definição de cada indicador, num só serviço.
- [ ] **Zero `.catch(fallback)` no frontend.** Um 403 diz "módulo não licenciado", um 401 leva ao login, um 500 mostra o `requestId`.
- [ ] Endpoints do frontend conferidos contra as rotas reais (o financeiro chamava `/cashflow/projections` quando a rota era `/cashflow/projection`).
- [ ] Zero emojis na interface — SVG inline (`AGENTS.md` §4).
- [ ] Zero `prompt()` / `confirm()` / `alert()`.
- [ ] CSV com BOM UTF-8 e separador `;`.
- [ ] Paridade pt/en em `locales/`.

---
---

# PARTE II — MÓDULO **HCCALL TELECOM** (`hccall`)

## II.1 O que é, e o que não é

Ferramenta operacional para **operadores de call center e vendedores de loja de telecomunicações**. Mobile first, poucos toques, utilizável durante uma chamada e com uma mão.

**Não é um CRM.** Não tem funil, não tem oportunidades, não tem campanhas de marketing, não tem tabela rígida de comissões. O utilizador configura os seus próprios serviços, as suas dinamizações e os seus valores.

O ciclo completo é este e mais nada:

```
cliente → venda → serviço → dinamização → comissão → alterações → histórico
```

```ts
// backend/src/modules/hccall/module.manifest.ts
export const manifest = {
  key: 'hccall',
  name: 'HCCALL Telecom',
  icon: 'headset',
  color: '#0d419f',
  routePrefix: '/api/hccall',
  frontendEntry: '/hccall.html',
  permissions: ['hccall.use'],          // um só papel funcional — ver I.3
  features: ['offline', 'commissions', 'promotions'],
  defaultLimits: { vendas: 50000, clientes: 20000 }
};
```

## II.2 Decisão de arquitetura: página própria, não vista dentro do `app.html`

O `app.html` é uma consola de secretária de 89 KB, com tabelas largas e navegação lateral. O HCCALL é o oposto: um ecrã que se usa em pé, ao telefone, com o polegar.

**Decisão:** o HCCALL tem entrada própria, **`backend/public/hccall.html`**, mobile-first e instalável como PWA (manifest + service worker), **dentro da mesma plataforma**: mesma autenticação JWT, mesma sessão `erp_session`, mesmo `GET /api/me/workspace`, mesmo `requireApp('hccall')`. Não duplica autenticação nem infraestrutura — duplica apenas a superfície de interação, que é precisamente o que tem de ser diferente.

Do `workspace.html`, o cartão do módulo abre `/hccall.html`. Do `app.html`, existe atalho para a mesma página.

## II.3 Modelo de dados

Todos os modelos: `tenantId`, `ownerUserId`, `deletedAt`, entrada em `TENANT_SCOPED_MODELS`.

```prisma
model HccallCustomer {
  id           String   @id @default(cuid())
  tenantId     String
  ownerUserId  String
  customerNumber String            // identificador operacional principal
  name         String?
  phone        String?
  notes        String?
  deletedAt    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([tenantId, customerNumber])
  @@index([tenantId, ownerUserId])
  @@map("hccall_customers")
}

model HccallService {                 // CRUD total do utilizador — nada hardcoded
  id          String   @id @default(cuid())
  tenantId    String
  ownerUserId String
  name        String                  // "Móvel", "MEO Fibra", "Equipamento"…
  color       String?
  sortOrder   Int      @default(100)
  active      Boolean  @default(true)
  deletedAt   DateTime?
  @@unique([tenantId, name])
  @@map("hccall_services")
}

model HccallPromotion {               // "dinamização"
  id                String   @id @default(cuid())
  tenantId          String
  ownerUserId       String
  name              String            // "Campanha Fibra Setembro"
  description       String?
  serviceId         String?
  suggestedCommissionCents Int  @default(0)   // SUGERIDO — ver II.4
  promoValueCents   Int?
  startsAt          DateTime? @db.Date
  endsAt            DateTime? @db.Date
  active            Boolean  @default(true)
  notes             String?
  version           Int      @default(1)      // sobe a cada alteração de valor
  deletedAt         DateTime?
  @@index([tenantId, active])
  @@map("hccall_promotions")
}

model HccallSaleStatus {              // estados configuráveis pelo utilizador
  id             String  @id @default(cuid())
  tenantId       String
  key            String              // "registada", "ativada", "paga"…
  label          String
  color          String?
  sortOrder      Int     @default(100)
  isTerminal     Boolean @default(false)
  commissionState String @default("FORECAST")  // FORECAST | CONFIRMED | PAID | VOID
  isSystem       Boolean @default(false)
  deletedAt      DateTime?
  @@unique([tenantId, key])
  @@map("hccall_sale_statuses")
}

model HccallSale {
  id            String   @id @default(cuid())
  tenantId      String
  ownerUserId   String
  code          String                    // #00125, contador atómico por tenant/ano
  clientUuid    String                    // UUID gerado no telemóvel — idempotência offline
  customerId    String?
  customerNumber String                   // desnormalizado: a venda sobrevive sem ficha
  serviceId     String?
  serviceName   String                    // desnormalizado, à data da venda
  promotionId   String?
  promotionName String?
  promotionVersion Int?
  promotionSnapshot Json?                 // a regra tal como estava — ver II.4
  commissionCents Int                     // VALOR EFETIVO desta venda
  saleValueCents  Int?
  statusId      String
  soldAt        DateTime @db.Date
  notes         String?
  deletedAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([tenantId, code])
  @@unique([tenantId, clientUuid])         // impede venda duplicada na sincronização
  @@index([tenantId, ownerUserId, soldAt])
  @@index([tenantId, statusId])
  @@map("hccall_sales")
}

model HccallSaleChange {               // histórico visível ao utilizador
  id          String   @id @default(cuid())
  tenantId    String
  saleId      String
  field       String                   // "commissionCents" | "statusId" | "promotionId"…
  oldValue    String?
  newValue    String?
  reason      String?
  changedByUserId String
  changedAt   DateTime @default(now())
  @@index([tenantId, saleId, changedAt])
  @@map("hccall_sale_changes")
}

model HccallContact {                  // atividade opcional sobre o cliente
  id          String   @id @default(cuid())
  tenantId    String
  ownerUserId String
  customerId  String
  kind        String                   // CALL | STORE | MESSAGE | NOTE
  summary     String
  occurredAt  DateTime @default(now())
  deletedAt   DateTime?
  @@index([tenantId, customerId, occurredAt])
  @@map("hccall_contacts")
}

model HccallCounter {
  tenantId String
  year     Int
  scope    String                      // "sale"
  value    Int @default(0)
  @@id([tenantId, year, scope])
  @@map("hccall_counters")
}
```

## II.4 A regra crítica: a dinamização sugere, a venda guarda

Esta é **a** regra do módulo. Se falhar, o histórico de comissões fica falsificado retroativamente.

- `HccallPromotion.suggestedCommissionCents` é **apenas um valor por defeito**.
- `HccallSale.commissionCents` é o **valor efetivo**, gravado na venda no momento em que é criada.
- Alterar a dinamização de 35 € para 50 € **não altera uma única venda já registada**. Sobe `version` da dinamização e mais nada.
- Uma venda só muda de comissão quando o utilizador a abre e a altera **explicitamente** — e essa alteração gera `HccallSaleChange` e `AuditLog`.

**`promotionSnapshot` guarda a regra inteira à data da venda** (nome, valor sugerido, serviço, versão, datas), em JSON. Sem isto, daqui a seis meses ninguém consegue explicar porque é que aquela venda tem 40 € — e a explicação é precisamente o que se pede quando há uma discussão sobre comissões.

Escreve o teste que fecha esta regra: criar venda com 35 €, alterar a dinamização para 50 €, reler a venda → **continua 35 €**, e o snapshot mantém a versão original.

## II.5 Estados da venda

Estados **configuráveis em tabela**, não em enum — o utilizador cria os seus. Semeados por omissão: Registada · Pendente · Em validação · Ativada · Cancelada · Rejeitada · Comissionada · Paga.

Cada estado carrega `commissionState` (`FORECAST | CONFIRMED | PAID | VOID`). É esse campo — e não o nome — que alimenta os relatórios de comissões previstas, confirmadas, pagas e anuladas. Sem ele, um utilizador que renomeie "Paga" para "Recebida" parte os relatórios em silêncio.

Sem workflows complexos: qualquer estado pode passar a qualquer estado. A prioridade é velocidade operacional. Mas **toda** a mudança escreve `HccallSaleChange`.

## II.6 Offline-first — o que isto exige mesmo

Um operador em zona de má cobertura tem de conseguir registar a venda. Isto não é "guardar no IndexedDB e esperar pelo melhor".

**Escrita local:** o cliente gera `clientUuid` (UUID v4) **no telemóvel**, escreve a venda no IndexedDB e coloca a operação numa fila. A interface mostra o estado real: `guardada localmente` → `sincronização pendente` → `sincronizada`.

**Sincronização:** `POST /api/hccall/sync` recebe um lote de operações, cada uma com o seu `clientUuid`. O servidor aplica-as em transação e é **idempotente por `@@unique([tenantId, clientUuid])`** — reenviar o mesmo lote nunca duplica uma venda. Resposta devolve, por operação, `applied | duplicate | conflict` e o registo canónico do servidor.

**Conflitos:** se a mesma venda foi alterada offline e no servidor, a política é **servidor ganha e o cliente é notificado** — nunca sobrescrever em silêncio. A operação local rejeitada fica visível numa lista "por resolver". Numa ferramenta de comissões, perder uma alteração sem aviso é pior do que pedir ao utilizador que decida.

**A armadilha do token:** o JWT expira em 8 h (`JWT_EXPIRES_IN`). Um operador que fique offline mais tempo do que isso vai ter a fila cheia e o token morto. A fila **sobrevive à expiração**: ao voltar a haver rede, se o token expirou, pede-se nova autenticação e **só depois** se sincroniza. Nunca se descarta a fila por erro 401. Testa este caso — é o mais provável de acontecer na vida real e o mais fácil de esquecer.

**Dados em cache local** são apenas os do próprio utilizador, e limpam-se no logout (o `qa/CONTRATO.md` já exige limpeza integral de sessão).

## II.7 Ecrãs (mobile first)

**Início** — a resposta a "como estou hoje", sem scroll:

```
HCCALL TELECOM

HOJE          12 vendas
              438,50 €  comissões
              10 ativadas · 2 pendentes

ESTE MÊS      127 vendas
              4.280,00 €  comissões

        [  + NOVA VENDA  ]
```

**Nova venda** — o ecrã mais importante do módulo. Alvo: **menos de 20 segundos e menos de 8 toques**.

```
Número de cliente   [ 123456789 ]      ← se existir, mostra logo o histórico
Serviço             [ Internet     ▼ ]
Dinamização         [ Fibra Setembro ▼ ]   ← preenche a comissão automaticamente
Comissão            [ 35,00 € ]            ← editável antes de guardar
Estado              [ Registada    ▼ ]
Observações         [ ................ ]

                    [  GUARDAR  ]
```

**Vendas** — lista agrupada por dia, com pesquisa e filtros (período, cliente, serviço, dinamização, estado, valor, comissão). Cada linha: código, cliente, serviço, comissão, estado.

**Venda** — detalhe com **EDITAR** e separador **Histórico**, que mostra as alterações em linguagem natural:

```
08/09  15:32   Comissão      35 €  →  40 €
08/09  15:31   Dinamização   Fibra Agosto  →  Fibra Setembro
08/09  15:30   Estado        Pendente  →  Ativada
```

**Cliente** — número, contadores (vendas, comissões acumuladas) e contactos opcionais.

**Configuração** — CRUD de Serviços, Dinamizações e Estados. Tudo do utilizador, nada hardcoded.

Requisitos de interface: botões com alvo ≥ 44 px, uso com uma mão, teclado numérico para número de cliente e valores, indicador de sincronização sempre visível, funcionamento com uma mão e em ecrã pequeno. Zero emojis: ícones SVG.

## II.8 Relatórios

**Vendas:** total, por período, por serviço, por dinamização, por estado.
**Comissões:** previstas, confirmadas, pagas, pendentes, anuladas — calculadas por `commissionState`, nunca pelo nome do estado.
**Desempenho:** vendas/dia, vendas/mês, comissão média, serviços mais vendidos, dinamizações mais utilizadas.

Todos com exportação CSV (BOM UTF-8, separador `;`).

## II.9 RGPD — e um ponto que tem de ser decidido antes de vender isto

Privacy by design e by default, minimização de dados: guarda-se o número de cliente e pouco mais; nome e contacto são opcionais.

> ⚠️ **Decisão que não é técnica e tem de ser tomada por quem vende o produto.**
> O número de cliente de uma operadora é **dado pessoal** — identifica indiretamente uma pessoa. Quando um operador de call center regista números de clientes do seu empregador numa ferramenta própria, é preciso estar definido **quem é o responsável pelo tratamento**: o operador, a empresa que o emprega, ou a operadora dona da relação com o cliente. Se essa definição não existir, o utilizador pode estar a tratar dados de terceiros sem base legal — e o risco não é do software, é dele.
>
> O sistema deve estar preparado para as duas leituras: definição do tenant `hccall.customerRef.mode` = `FULL` (guarda o número) ou `HASHED` (guarda apenas um derivado irreversível para agrupar vendas do mesmo cliente sem armazenar o número). Por omissão, `FULL`, com aviso claro na primeira utilização.
>
> Não sou jurista. Isto **tem de ser confirmado** com quem o seja antes de o produto ser vendido a terceiros. É a única forma de o produto ser vendável com segurança.

Implementa ainda: política de retenção configurável, exportação dos dados do utilizador, e anonimização dirigida a um cliente identificado — com permissão, confirmação explícita e auditoria. **Não copies o endpoint de anonimização do módulo financeiro**, que apaga o histórico inteiro de um tenant sem confirmação nem registo.

## II.10 IA — preparar, não complicar

Nada de IA na v1. Prepara a camada: um serviço de consulta **só de leitura**, com uma **lista fechada** de perguntas suportadas (vendas do mês, comissões pendentes, serviço mais vendido, vendas com comissão alterada), sempre filtrado por `tenantId` **e** pelo âmbito de visibilidade do utilizador. **Nunca SQL livre gerado por modelo.**

---
---

# PARTE III — MÓDULO **2SELLMAIS** (`sellmais`)

## III.1 O que é

Gestão, inventário e comercialização de artigos em segunda mão e antiguidades: da aquisição à venda, com proveniência, custos reais, localização física, canais de venda e histórico.

```ts
export const manifest = {
  key: 'sellmais',
  name: '2SELLMAIS',
  icon: 'archive',
  color: '#9A7328',
  routePrefix: '/api/sellmais',
  frontendEntry: '/app.html#/sellmais',
  permissions: [
    'sellmais.item.read', 'sellmais.item.write', 'sellmais.item.delete',
    'sellmais.cost.read', 'sellmais.price.write', 'sellmais.channel.publish',
    'sellmais.auction.manage', 'sellmais.consignment.manage', 'sellmais.admin'
  ],
  features: ['inventory', 'provenance', 'media', 'channels', 'auctions', 'consignment'],
  defaultLimits: { artigos: 10000, canais: 5 }
};
```

Ao contrário do HCCALL, este módulo **tem** hierarquia de permissões: numa loja, um colaborador não pode saber por quanto a peça foi comprada.

## III.2 Reutiliza — não dupliques

| Já existe | Usa para |
| :--- | :--- |
| `Company` (+ `CompanyContact`, `CompanyAddress`, `CompanyDocument`, `Contract`) | Fornecedores, consignantes, compradores. **Não crias `Supplier` nem `Client`.** |
| `FinanceTransaction`, `FinanceAccount`, `CostCenter`, `FinanceCategory` | Pagamento da compra, custos, encaixe da venda. |
| `Role`, `RolePermissionLink`, `Permission` | Perfis do módulo. |
| `AuditLog` + `AuditService` | Registo inviolável. |
| `TenantBranding` | Moeda, locale, IVA, identidade do catálogo público. |

## III.3 Atributos por tipo de artigo — JSONB validado, não EAV

Uma cómoda, uma pintura, um relógio e um vinil têm atributos diferentes.

**EAV** (tabela atributo/valor) transforma qualquer filtro em cinco *joins* e impede indexação: **não usar**. A decisão é **JSONB com esquema declarado**: `SellItemType.fields` define os campos; `SellItem.attributes` é `Json`, validado no servidor com Zod construído em runtime a partir dessa definição, e indexado com **GIN**.

```prisma
model SellItemType {
  id String @id @default(cuid())
  tenantId String
  key String                 // "mobiliario" | "pintura" | "joia" | "relogio" | "vinil"
  name String
  icon String?
  fields Json                // [{ key, label, type, required, options[], unit, showInPublic }]
  isSystem Boolean @default(false)
  deletedAt DateTime?
  @@unique([tenantId, key])
  @@map("sell_item_types")
}
```

Tipos de campo aceites: `text | number | integer | money | date | enum | boolean`. Alterar a definição **nunca** apaga valores guardados — campos removidos permanecem no JSON e deixam de ser mostrados.

## III.4 Artigo

```prisma
enum SellItemStatus { DRAFT AVAILABLE RESERVED IN_RESTORATION IN_AUCTION SOLD RETURNED UNAVAILABLE WRITTEN_OFF }
enum SellAcquisitionType { PURCHASE CONSIGNMENT TRADE_IN DONATION }

model SellItem {
  id String @id @default(cuid())
  tenantId String
  code String                       // HL-2026-00125, contador atómico (I.7)
  slug String                       // catálogo público
  typeId String
  title String
  shortDescription String?
  description String?
  attributes Json @default("{}")

  categoryId String?
  period String?                    // "Séc. XIX", "Anos 60"
  style String?
  material String?
  maker String?
  conditionGrade String?
  conditionNotes String?
  dimensions Json?                  // { w, h, d, unit, weight }

  quantity Int @default(1)
  isUnique Boolean @default(true)   // peça única vs lote

  status SellItemStatus @default(DRAFT)
  acquisitionType SellAcquisitionType @default(PURCHASE)

  acquisitionCents Int @default(0)
  extraCostsCents  Int @default(0)  // derivado de SellItemCost, materializado
  totalCostCents   Int @default(0)
  askingPriceCents Int?
  minPriceCents    Int?             // interno
  soldPriceCents   Int?

  supplierCompanyId String?
  buyerCompanyId String?
  assignedUserId String?
  locationId String?

  publishedAt DateTime?
  availableSince DateTime?          // base de "parado há X dias"
  soldAt DateTime?
  tags String[] @default([])
  internalNotes String?
  vatMarginScheme Boolean @default(false)   // regime de margem — ver III.10

  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, code])
  @@unique([tenantId, slug])
  @@index([tenantId, status, availableSince])
  @@index([tenantId, deletedAt])
  @@map("sell_items")
}
```

`extraCostsCents` e `totalCostCents` são **derivados mas materializados**, recalculados na mesma transação em que uma linha de custo entra, muda ou é anulada. Sem isto, listar 400 artigos com margem faz 400 agregações — o mesmo N+1 do dashboard financeiro.

## III.5 Satélites

`SellItemCost` (transporte, restauro, peritagem, taxas — com `financeTransactionId`) · `SellItemMedia` (original **intocado** + derivadas + checksum SHA-256) · `SellProvenance` (1:1, com `confidence` = `CONFIRMED | ESTIMATED | UNVERIFIED` e `isPublic`) · `SellRestoration` (custos entram no custo real) · `SellLocation` (árvore com `path` materializado: Loja › Sala 2 › Zona B › Estante 4 › Posição 12) · `SellItemEvent` (timeline **do negócio**; o `AuditLog` continua a ser o registo técnico — são coisas diferentes e escrevem-se as duas) · `SellCounter`.

## III.6 Consignação — o que faltava no conceito original

Numa loja de segunda mão, **boa parte do stock não é da loja**: está à consignação, com comissão. Isto muda três números de uma vez.

```prisma
model SellConsignment {
  id String @id @default(cuid())
  tenantId String
  consignorCompanyId String
  reference String
  startedAt DateTime @db.Date
  endsAt DateTime? @db.Date
  commissionPercent Int?            // pontos percentuais × 100 (3000 = 30 %)
  commissionFixedCents Int?
  minPriceCents Int?
  status String @default("ACTIVE")  // ACTIVE | SETTLED | RETURNED | CANCELLED
  settlementNotes String?
  deletedAt DateTime?
  @@unique([tenantId, reference])
  @@map("sell_consignments")
}

model SellConsignmentItem {
  id String @id @default(cuid())
  tenantId String
  consignmentId String
  itemId String @unique
  agreedPriceCents Int?
  soldPriceCents Int?
  commissionCents Int?
  payoutCents Int?
  settledAt DateTime?
  financeTransactionId String?
  @@map("sell_consignment_items")
}
```

Regras obrigatórias: um artigo consignado **não entra no valor do inventário** da loja (o painel separa **próprio** de **consignado**); a margem de um consignado é a **comissão**, não `preço − custo`; vender abaixo do `minPriceCents` exige confirmação explícita e fica auditado; prazo a expirar gera alerta a 30/15/7 dias.

## III.7 Canais — padrão *outbox*, nunca chamada direta

Publicar ou despublicar não pode ser um `await` dentro do pedido que muda o estado da peça: se o canal estiver em baixo, ou perdes a alteração ou bloqueias o utilizador.

```
mudança de estado  →  grava SellChannelJob (PENDING, idempotencyKey)  ← MESMA transação
                   →  cron consome, chama o adaptador, retenta com backoff
                   →  SellChannelListing atualizado (externalId, estado, último erro)
```

Modelos: `SellChannel` (com `capabilities.manualOnly`), `SellChannelListing` (`@@unique([tenantId, itemId, channelId])`), `SellChannelJob` (`@@unique([tenantId, idempotencyKey])`).

Quando o estado passa a `SOLD | RESERVED | UNAVAILABLE | RETURNED | WRITTEN_OFF` são criados jobs `UNPUBLISH` para **todos** os listings ativos, na mesma transação. Falha de canal **nunca** impede a venda — fica visível como "por retirar de X".

Canais sem API pública ficam `manualOnly`: a plataforma prepara o conteúdo, regista onde está anunciado e **avisa** que é preciso retirar à mão. Isto é honestidade de produto, não uma limitação a esconder.

> ⚠️ **A Vercel não corre processos permanentes.** O consumidor da fila é uma rota protegida invocada por **Vercel Cron**, com bloqueio contra execuções simultâneas. O mesmo vale para o fecho de leilões. Declara isto no plano da Fase 0.

## III.8 Máquina de estados

```
DRAFT ──► AVAILABLE ──┬──► RESERVED ──► SOLD
                      ├──► IN_RESTORATION ──► AVAILABLE
                      ├──► IN_AUCTION ──► SOLD
                      └──► UNAVAILABLE / RETURNED / WRITTEN_OFF
```

Uma única função de transição (`SellItemStateService`). Nenhum controller altera `status` diretamente. Cada transição valida a origem, exige os campos necessários (não se publica sem preço nem sem foto de capa), grava `SellItemEvent`, escreve `AuditLog` e enfileira os jobs de canal — **tudo numa transação**. Transição inválida devolve 409 explicado, nunca falha em silêncio.

## III.9 Custo real, margem e ligação às finanças

Definições únicas em `docs/2SELLMAIS_DEFINICOES.md`, cobertas por testes:

- **Custo real** = `acquisitionCents` + Σ custos não anulados.
- **Margem (próprio)** = `soldPriceCents − totalCostCents`.
- **Margem (consignado)** = comissão.
- **Valor do inventário** = Σ `totalCostCents` de `AVAILABLE|RESERVED|IN_RESTORATION|IN_AUCTION`, **separando próprio de consignado**.
- **Dias parado** = hoje − `availableSince` (não `createdAt`: uma peça que esteve seis meses em restauro não esteve seis meses à venda).
- **Rotação** = vendidos no período ÷ média de disponíveis no período.

Lançamentos automáticos em `FinanceTransaction` (compra, custos, venda, acerto de consignação), com `id` guardado nos dois sentidos, ativáveis por `sellmais.finance.autoPost` (por omissão ligado). **Anular um artigo nunca apaga o lançamento** — cria estorno auditado.

## III.10 Fotografia, IA e conformidade

**Pipeline assíncrono:** o upload responde depressa; o tratamento acontece a seguir e a ficha atualiza-se.

> **Integridade da imagem — não configurável.** O tratamento melhora as condições de captação: luz, nitidez, enquadramento, fundo. **Não altera a peça**: não remove defeitos, marcas de uso, riscos ou danos. O original fica sempre guardado. Um comprador que receba peça diferente da fotografia é uma devolução, uma reclamação e uma reputação.

> **Facto vs estimativa — obrigatório.** `confidence` e atributos estimados aparecem na interface e no texto gerado. **Autenticidade, época, autoria e atribuição nunca são afirmadas como facto** sem confirmação de quem tenha competência para o fazer. A IA escreve "atribuível a", "estilo", "aproximadamente" — nunca "original de".

Guarda, por descrição gerada: modelo, versão do prompt, texto proposto, texto final e quem aprovou.

**Ficheiros:** a Vercel serverless **não tem disco persistente com escrita**. Fotografias e documentos exigem Vercel Blob, S3 ou R2, decidido antes da Fase de media. Enquanto não existir, **não constróis botão de upload** — constróis a tabela com estado "sem armazenamento configurado" (`qa/CONTRATO.md` ponto 11 proíbe botões mortos).

**Catálogo público:** o frontend é HTML estático; uma loja online precisa de **uma página por artigo com HTML real**, senão não é indexada nem partilhável. Rotas Fastify que devolvem HTML gerado no servidor (`GET /loja`, `GET /loja/artigo/:slug`) com `<title>`, meta description, Open Graph, JSON-LD `Product` e `sitemap.xml`.

**Público vs interno:** lista branca explícita. **Nunca públicos:** preço de aquisição, custos, margem, preço mínimo, preço de reserva de leilão, fornecedor, consignante, comissões, notas internas, localização física. Escreve um **teste que falha** se um campo interno aparecer numa resposta pública.

**Conformidade a confirmar com jurista/contabilista do cliente** (não sou jurista; o sistema fica preparado):
- Compra de bens usados a particulares tem obrigações de registo; o comércio de **ouro e metais preciosos** tem regras próprias de identificação do vendedor e deveres de prevenção de branqueamento. Prevê bloco de **identificação do vendedor** (`sellmais.acquisition.requireSellerId`), **livro de aquisições** sequencial e exportável, com esses campos tratados como dados pessoais sensíveis (acesso `sellmais.admin`, cifrados, fora de exportações genéricas).
- **Regime de IVA sobre a margem** para bens em segunda mão: o módulo não fatura nem apura imposto, mas guarda o que o contabilista precisa (`vatMarginScheme` por artigo, base de aquisição, base de venda).

## III.11 Leilões (última fase)

`SellAuction` · `SellAuctionLot` (com `reservePriceCents` **nunca exposto**) · `SellBid`.

> ⚠️ **Concorrência em licitações é onde estes sistemas partem.** A inserção de licitação corre em transação com **`SELECT … FOR UPDATE` sobre o lote** (ou `SERIALIZABLE` com retry): valida `amount >= currentBid + minIncrement`, atualiza o lote e marca a anterior `OUTBID` — tudo dentro da mesma transação. Teste obrigatório: **50 licitações em paralelo → exatamente um vencedor** e sequência estritamente crescente. Anti-sniping prolonga o fecho. Fecho por cron, não por temporizador em memória.
>
> Só arranca depois de o regulamento e as condições de participação estarem validados: envolve obrigações contratuais reais entre licitante e vendedor.

## III.12 Interface

Vista `#/sellmais` no `app.html`: Visão Geral · Artigos · Novo Artigo · Consignações · Canais · Leilões · Clientes & Interesses · Localizações · Documentos · Configuração.

O ecrã mais importante é o **registo rápido em telemóvel**: fotografar, título, tipo, preço de compra, gravar. Tudo o resto fica para depois, com o indicador de completude a puxar.

---
---

# PARTE IV — EXECUÇÃO

## IV.1 Ordem recomendada

**Faz o HCCALL primeiro.** É mais pequeno, tem menos dependências externas (não precisa de armazenamento de ficheiros nem de cron), valida o processo de registo de um módulo novo de ponta a ponta, e resolve a superfície mobile/PWA que o 2SELLMAIS vai reaproveitar no registo rápido de artigos.

| Fase | Módulo | Conteúdo |
| :--- | :--- | :--- |
| **0** | ambos | Auditoria e plano. Sem código. Entregar `docs/PLANO_HCCALL_2SELLMAIS.md`. |
| **1** | hccall | Registo do módulo (10 passos de I.5), schema, contador, serviços, dinamizações, estados. |
| **2** | hccall | Vendas: criação, edição, histórico de alterações, regra da comissão efetiva. |
| **3** | hccall | `hccall.html` mobile-first + PWA. Início, nova venda, lista, detalhe, configuração. |
| **4** | hccall | Offline: IndexedDB, fila, `POST /sync` idempotente, conflitos, expiração de token. |
| **5** | hccall | Clientes, contactos, relatórios, exportações. |
| **6** | sellmais | Registo do módulo, `SellItemType`, `SellItem`, custos, localizações, timeline, máquina de estados, registo rápido. |
| **7** | sellmais | Proveniência, media (depois de decidido o armazenamento), restauros. |
| **8** | sellmais | Consignação, clientes e interesses, separação próprio/consignado. |
| **9** | sellmais | Catálogo público com HTML gerado no servidor, SEO, reservas. |
| **10** | sellmais | IA de imagem e descrições. |
| **11** | sellmais | Canais: outbox, cron, adaptadores, modo manual honesto. |
| **12** | sellmais | Leilões, depois do regulamento validado. |
| **13** | ambos | Painéis, alertas, relatórios. |
| **14** | ambos | QA visual (Playwright, desktop e telemóvel) e correção da documentação. |

Cada fase acaba com `npm run verify` verde, commit próprio e `DIARIO.md` atualizado.

## IV.2 Testes obrigatórios

**Comuns aos dois módulos**
- Tenant A não lê, não altera e não apaga nada do tenant B, em **todos** os endpoints.
- Sem licença → 403 `APP_NOT_LICENSED` em todos os endpoints do módulo.
- Soft delete não reduz a contagem na base de dados; o restauro repõe.
- Código sequencial único sob 100 criações concorrentes.
- Nenhuma listagem devolve mais de 200 registos por página.
- Paridade pt/en; zero emojis no HTML renderizado; zero erros de consola.

**HCCALL**
- Criar venda com 35 € → alterar a dinamização para 50 € → a venda **continua** 35 € e o snapshot mantém a versão original. *(É o teste que define o módulo.)*
- Alterar comissão e estado → `HccallSaleChange` com valor anterior e novo, autor e data.
- `hccall.visibility = OWN` → o utilizador A não vê as vendas do utilizador B do mesmo tenant. `TEAM` → vê.
- Sincronizar o mesmo lote duas vezes → nenhuma venda duplicada.
- Registar venda offline, ficar offline mais de 8 h, voltar: a fila sobrevive, pede reautenticação e sincroniza sem perder nada.
- Relatório de comissões calculado por `commissionState` — renomear um estado não altera os totais.

**2SELLMAIS**
- Custo real = aquisição + custos; margem própria vs consignada.
- Transições válidas passam, inválidas devolvem 409; publicar sem preço ou sem foto de capa é recusado.
- Passar a `SOLD` cria jobs `UNPUBLISH` para todos os canais ativos; job repetido com a mesma `idempotencyKey` não duplica anúncio; falha de canal não impede a venda.
- 50 licitações concorrentes → um vencedor, valores estritamente crescentes; preço de reserva nunca aparece em resposta pública.
- Nenhuma resposta pública contém campos internos (teste por lista branca).
- Sem `sellmais.cost.read` → a API não devolve custos nem margem (filtrado no **servidor**, não escondido no ecrã).

**Verificação final, para ambos:** correr a aplicação, abrir cada ecrã e **comparar os números do painel com uma query SQL direta**. Se não bater, não está pronto — mesmo que compile.

## IV.3 Entregáveis

- `docs/PLANO_HCCALL_2SELLMAIS.md` (Fase 0)
- `docs/HCCALL_DEFINICOES.md` e `docs/2SELLMAIS_DEFINICOES.md` — definição única de cada indicador
- `docs/RELATORIO_HCCALL_2SELLMAIS.md` — o que foi criado ficheiro a ficheiro; migrações com contagens antes/depois; testes e resultados; decisões e porquê; o que ficou por fazer; **dívida técnica criada, declarada em `DIVIDA_TECNICA.md` e não escondida**
- `ESTADO.md`, `docs/MODULOS.md`, `docs/INVENTARIO.md` e `assets/js/modules.js` atualizados para descreverem o que **existe**

---

# REGRA FINAL

Os dois módulos partilham a plataforma, mas resolvem problemas opostos e a interface tem de o refletir: **o HCCALL é velocidade** — uma venda registada durante uma chamada, com uma mão, sem rede; **o 2SELLMAIS é memória** — uma peça que entra pela porta e sai vendida sem perder a sua história, os seus custos e o seu percurso.

Três condições de aceitação, iguais para os dois:

1. **O que o painel mostra é o que a base de dados tem.** Uma definição por indicador, num só serviço.
2. **Nada se perde.** Nem uma venda gravada offline, nem o valor de uma comissão antiga, nem o histórico de uma peça.
3. **Nenhum erro é silencioso.** Sem `.catch` a esconder 403, sem sanitizadores a adivinhar valores, sem sincronizações a descartar o que não conseguem aplicar.

E, acima de tudo: **se em algum momento não conseguires garantir que nenhum dado se perde, para e reporta.** Uma funcionalidade em falta corrige-se numa tarde; um histórico de comissões ou um inventário de antiguidades perdido, não.
