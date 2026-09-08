# PROMPT DE EXECUÇÃO — ANTIGRAVITY
## HELDERLABS ERP · Módulo **2SELLMAIS**
### Gestão, inventário e comercialização de artigos em segunda mão e antiguidades

> **Diretoria canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Módulo novo:** 2SELLMAIS · **Alvo:** v0.5.0
> **Documento escrito a partir do estado real do repositório** (schema Prisma, módulos `crm`, `financas`, `platform`, `condominios`, ecrãs em `backend/public/`).
> Complementa — não substitui — `AGENTS.md`, `CLAUDE.md`, `qa/CONTRATO.md` e `docs/PROMPT_ANTIGRAVITY_FIN_CRM.md`.

---

# 0. REGRAS ABSOLUTAS

1. **Fase 0 primeiro.** Auditoria e plano escrito antes de qualquer linha de código. Entregável obrigatório.
2. **NADA É APAGADO.** Sem `DROP`, sem `migrate reset`, sem `db push --accept-data-loss`. Eliminação é sempre lógica (`deletedAt`).
3. **Migrações aditivas e reversíveis.** Colunas novas anuláveis ou com `DEFAULT`. Nunca renomear coluna em uso.
4. **Backup lógico antes de migrar**, com verificação de que o ficheiro tem tamanho > 0.
5. **`guard-db.mjs` não se contorna.** Dev e migrações dev só contra `localhost`.
6. **O tenant vem sempre de `request.user.tenantId`.** Nunca de query, body ou header.
7. **Proibido `PrismaClient` cru fora de `tenantScopedClient.ts`** (ADR 001). Sem exceções neste módulo.
8. **Toda a escrita relevante regista `AuditService`.**
9. **`cd backend && npm run verify` verde antes e depois de cada fase.**
10. **O código é a fonte da verdade, não a documentação.** Se um `.md` contradisser o código, o código ganha e o `.md` corrige-se.

---

# 1. O QUE JÁ EXISTE E TENS DE REUTILIZAR

O repositório evoluiu. Antes de criares seja o que for, confirma no `schema.prisma` — **estas entidades já existem e o 2SELLMAIS liga-se a elas em vez de as duplicar**:

| Já existe | Usa para |
| :--- | :--- |
| `Company` (+ `CompanyContact`, `CompanyAddress`, `CompanyDocument`, `CompanyRelation`, `Contract`) | Fornecedores, consignantes, compradores, leiloeiras. **Não crias `Supplier` nem `Client`.** |
| `FinanceTransaction` (cêntimos, `dueDate`, `companyId`, `costCenterId`, `accountId`, `deletedAt`) | Pagamento da compra, custos de restauro e transporte, encaixe da venda. |
| `FinanceAccount`, `CostCenter`, `FinanceCategory` | Conta que pagou/recebeu, centro de custo, categorização financeira. |
| `Role`, `RolePermissionLink`, `Permission` | Perfis e permissões do módulo. **Não inventas um sistema de permissões próprio.** |
| `AuditLog` + `AuditService` (hash chain SHA-256) | Registo de todas as alterações. |
| `Module`, `ApplicationInstance`, `ApplicationAssignment`, `EntitlementService` | Licenciamento do módulo por empresa, com `validUntil`, plano e limites. |
| `TenantBranding` | Moeda, locale, fuso, IVA, identidade visual do catálogo público. |
| `tenantScopedClient.ts` | Isolamento automático por tenant. |

**Duas consequências práticas:**

- Uma peça comprada a um particular ou a um antiquário cria/liga uma `Company` (com `entityType` particular quando for o caso). A ficha do fornecedor já tem contactos, moradas, documentos e histórico — aproveita tudo.
- Nenhum valor monetário do 2SELLMAIS é calculado com `Float`. O módulo financeiro já está em cêntimos inteiros e o `qa/CONTRATO.md` ponto 12 exige-o.

---

# 2. DECISÕES DE ARQUITETURA — FIXADAS, NÃO NEGOCIÁVEIS

## 2.1 A chave técnica do módulo NÃO pode ser `2sellmais`

**2SELLMAIS é o nome comercial. A chave técnica é `sellmais`.**

Isto não é preciosismo. Um identificador começado por dígito parte em sítios concretos deste projeto:

- **CSS:** `#2sellmais` é um seletor inválido. O `app.html` usa `id="view-<chave>"` e `document.querySelector('#...')` — um dia alguém escreve `#2sellmais` e o ecrã deixa de aparecer sem erro visível.
- **JavaScript:** `manifest.apps.2sellmais` é erro de sintaxe; obriga a `['2sellmais']` para sempre.
- **Consistência:** todas as chaves existentes (`crm`, `condominios`, `financas`, `platform`) respeitam `^[a-z][a-z0-9_-]*$`.

```ts
// backend/src/modules/sellmais/module.manifest.ts
export const manifest = {
  key: 'sellmais',              // técnico, imutável
  name: '2SELLMAIS',            // rótulo de UI, é este que o utilizador vê
  icon: 'archive',
  color: '#9A7328',
  routePrefix: '/api/sellmais',
  frontendEntry: '/app.html#/sellmais',
  permissions: [
    'sellmais.item.read', 'sellmais.item.write', 'sellmais.item.delete',
    'sellmais.cost.read', 'sellmais.price.write',
    'sellmais.channel.publish', 'sellmais.auction.manage',
    'sellmais.consignment.manage', 'sellmais.admin'
  ],
  features: ['inventory', 'provenance', 'media', 'channels', 'auctions', 'consignment'],
  defaultLimits: { artigos: 10000, canais: 5 }
};
```

> ⚠️ **O erro que não se repete:** o módulo financeiro ficou com a chave `financas` no manifesto e `finance` no `seed.ts`, e só não parte por causa de um *alias* hardcoded no `requireApp`. **Uma chave, um sítio.** Regista `sellmais` no `seed.ts`, no manifesto e no `Module` — e em mais lado nenhum.

## 2.2 Atributos por tipo de artigo — JSONB validado, não EAV

Uma cómoda, uma pintura, um relógio, uma joia e um disco de vinil têm atributos diferentes. Há duas soluções e uma delas é uma armadilha.

- **EAV** (tabela `atributo/valor`): flexível, mas transforma qualquer filtro em cinco *joins* e impede indexação decente. **Não usar.**
- **JSONB com esquema declarado** (a decisão): `ItemType` guarda a definição dos campos; `Item.attributes` é `Json`, validado no servidor contra essa definição com Zod construído em runtime, e indexado com GIN.

```prisma
model SellItemType {
  id        String  @id @default(cuid())
  tenantId  String
  key       String            // "mobiliario", "pintura", "joia", "relogio", "vinil"
  name      String
  icon      String?
  fields    Json              // [{ key, label, type, required, options[], unit, showInPublic }]
  isSystem  Boolean @default(false)
  deletedAt DateTime?
  @@unique([tenantId, key])
  @@map("sell_item_types")
}
```

Regras: os `fields` aceitam apenas os tipos `text | number | integer | money | date | enum | boolean`. Alterar a definição **nunca** apaga valores já guardados — campos removidos ficam no JSON e deixam de ser mostrados. Cria índice GIN em `attributes`.

## 2.3 Código do artigo — sequência atómica por tenant

O formato pedido é `HL-2026-00125`. Um `count(*) + 1` gera duplicados assim que duas pessoas registarem peças ao mesmo tempo.

```prisma
model SellCounter {
  tenantId String
  year     Int
  scope    String   // "item" | "auction" | "sale"
  value    Int      @default(0)
  @@id([tenantId, year, scope])
  @@map("sell_counters")
}
```

Incremento dentro da mesma transação da criação do artigo, com `UPDATE ... RETURNING` (bloqueio de linha). O prefixo é configurável por tenant (`TenantSetting` `sellmais.code.prefix`, por omissão as iniciais do tenant).

## 2.4 Armazenamento de ficheiros — obrigatório resolver antes da Fase 3

**A Vercel serverless não tem disco persistente com escrita.** Fotografias, documentos e certificados exigem armazenamento externo: **Vercel Blob**, S3 ou Cloudflare R2.

Enquanto não estiver provisionado: **não constróis botão de upload.** Constróis a tabela de media com estado `sem armazenamento configurado`. O `qa/CONTRATO.md` ponto 11 proíbe botões mortos, e um upload que falha em silêncio faz o utilizador perder trabalho.

Guarda sempre: o ficheiro original **intocado**, as derivadas (miniatura, catálogo, canal) e o `checksum` SHA-256 para deteção de duplicados.

## 2.5 Publicação em canais — padrão *outbox*, nunca chamada direta

Publicar ou despublicar não pode ser um `await` dentro do pedido HTTP que muda o estado da peça. Se o canal externo estiver lento ou em baixo, ou perdes a alteração ou bloqueias o utilizador.

```
mudança de estado do artigo
        │
        ▼
grava SellChannelJob (PENDING, idempotencyKey)   ← na MESMA transação
        │
        ▼
worker/cron consome, chama o adaptador do canal, retenta com backoff
        │
        ▼
SellChannelListing atualizado (externalId, estado, últimoErro)
```

⚠️ **A Vercel não corre processos permanentes.** O consumidor é uma rota protegida invocada por **Vercel Cron** (ou equivalente), com bloqueio para não haver duas execuções simultâneas. Declara isto explicitamente no plano da Fase 0.

## 2.6 Catálogo público e SEO — o buraco do stack atual

O frontend é HTML estático servido por `@fastify/static`. Uma loja online precisa de **uma página por artigo, com HTML real**, senão o Google não indexa e as partilhas em redes sociais saem sem imagem nem título.

Solução dentro do stack, sem trazer framework novo: rotas Fastify públicas que devolvem HTML gerado no servidor (`GET /loja`, `GET /loja/artigo/:slug`) com `<title>`, `<meta description>`, Open Graph e JSON-LD `Product`, mais `sitemap.xml` gerado a partir dos artigos disponíveis. Cache HTTP curto e invalidação na mudança de estado.

**Não publiques no catálogo público nenhum campo interno** — preço de aquisição, custos, margem, notas internas, dados do fornecedor. Ver §9.

---

# 3. MODELO DE DADOS

Tudo em cêntimos inteiros (`...Cents Int`), tudo com `tenantId`, tudo com `deletedAt`, tudo registado em `TENANT_SCOPED_MODELS` no `tenantScopedClient.ts` **na mesma alteração em que o modelo é criado** — esquecer isto é abrir uma fuga entre tenants.

## 3.1 Artigo

```prisma
enum SellItemStatus {
  DRAFT          // registado, ainda sem preço ou fotografias
  AVAILABLE
  RESERVED
  IN_RESTORATION
  IN_AUCTION
  SOLD
  RETURNED       // devolvido ao consignante
  UNAVAILABLE
  WRITTEN_OFF    // perda, dano irreparável
}

enum SellAcquisitionType {
  PURCHASE       // compra firme
  CONSIGNMENT    // à consignação
  TRADE_IN       // retoma
  DONATION
}

model SellItem {
  id            String   @id @default(cuid())
  tenantId      String
  code          String              // HL-2026-00125
  slug          String              // para o catálogo público
  typeId        String
  title         String
  shortDescription String?
  description   String?
  attributes    Json     @default("{}")

  categoryId    String?
  period        String?             // "Séc. XIX", "Anos 60"
  style         String?
  material      String?
  maker         String?             // autor / fabricante
  conditionGrade String?            // "Excelente" | "Bom" | "Razoável" | "Para restauro"
  conditionNotes String?
  dimensions    Json?               // { w, h, d, unit, weight }

  quantity      Int      @default(1)
  isUnique      Boolean  @default(true)   // peça única vs lote

  status        SellItemStatus @default(DRAFT)
  acquisitionType SellAcquisitionType @default(PURCHASE)

  // dinheiro — sempre cêntimos
  acquisitionCents Int      @default(0)
  extraCostsCents  Int      @default(0)   // derivado de SellItemCost, mantido na transação
  totalCostCents   Int      @default(0)   // acquisition + extraCosts
  askingPriceCents Int?
  minPriceCents    Int?                   // preço mínimo aceitável (interno)
  soldPriceCents   Int?

  supplierCompanyId String?               // Company: quem vendeu/consignou
  buyerCompanyId    String?               // Company: quem comprou
  assignedUserId    String?

  locationId    String?
  publishedAt   DateTime?
  availableSince DateTime?                // base do cálculo de "parado há X dias"
  soldAt        DateTime?
  tags          String[] @default([])
  internalNotes String?                   // nunca sai para o catálogo público

  deletedAt     DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([tenantId, code])
  @@unique([tenantId, slug])
  @@index([tenantId, status, availableSince])
  @@index([tenantId, deletedAt])
  @@map("sell_items")
}
```

`extraCostsCents` e `totalCostCents` são **derivados mas materializados**: recalculados na mesma transação em que se insere/altera/anula uma linha de custo. Sem isto, listar 400 artigos com margem obriga a 400 agregações — é exatamente o erro N+1 que o dashboard financeiro cometeu.

## 3.2 Satélites do artigo

```prisma
model SellItemCost {                 // transporte, restauro, peritagem, moldura, taxas
  id String @id @default(cuid())
  tenantId String
  itemId String
  kind String                        // TRANSPORT | RESTORATION | VALUATION | FEES | OTHER
  description String
  amountCents Int
  incurredAt DateTime @db.Date
  supplierCompanyId String?
  financeTransactionId String?       // ligação ao módulo financeiro
  deletedAt DateTime?
  @@index([tenantId, itemId])
  @@map("sell_item_costs")
}

model SellItemMedia {
  id String @id @default(cuid())
  tenantId String
  itemId String
  kind String                        // PHOTO | DOCUMENT | CERTIFICATE | VIDEO
  role String?                       // COVER | GALLERY | BEFORE | AFTER | ORIGINAL
  fileUrl String
  originalUrl String?                // original nunca substituído
  fileName String
  mimeType String
  sizeBytes Int
  checksum String?
  width Int?
  height Int?
  aiProcessed Boolean @default(false)
  aiOperations Json?                 // o que foi feito, para poder ser auditado
  sortOrder Int @default(100)
  isPublic Boolean @default(true)
  deletedAt DateTime?
  @@index([tenantId, itemId])
  @@map("sell_item_media")
}

model SellProvenance {               // 1:1 com o artigo
  id String @id @default(cuid())
  tenantId String
  itemId String @unique
  origin String?
  previousOwner String?
  originPlace String?
  acquiredAt DateTime? @db.Date
  knownHistory String?
  bibliography String?
  isPublic Boolean @default(false)   // o que se mostra no catálogo é decisão do lojista
  confidence String @default("ESTIMATED")  // CONFIRMED | ESTIMATED | UNVERIFIED
  @@map("sell_provenance")
}

model SellRestoration {
  id String @id @default(cuid())
  tenantId String
  itemId String
  startedAt DateTime @db.Date
  finishedAt DateTime? @db.Date
  responsible String?
  supplierCompanyId String?
  description String
  materials String?
  costCents Int @default(0)
  notes String?
  deletedAt DateTime?
  @@index([tenantId, itemId])
  @@map("sell_restorations")
}

model SellLocation {                 // árvore: Loja > Sala 2 > Zona B > Estante 4 > Posição 12
  id String @id @default(cuid())
  tenantId String
  parentId String?
  name String
  kind String?                       // SHOP | ROOM | ZONE | SHELF | SLOT | WAREHOUSE
  path String                        // materializado, para pesquisa e apresentação
  deletedAt DateTime?
  @@index([tenantId, parentId])
  @@map("sell_locations")
}

model SellItemEvent {                // a timeline da peça
  id String @id @default(cuid())
  tenantId String
  itemId String
  type String                        // ACQUIRED | PHOTOGRAPHED | DESCRIBED | PRICED |
                                     // PUBLISHED | UNPUBLISHED | RESERVED | RESTORED |
                                     // MOVED | AUCTIONED | SOLD | RETURNED | NOTE
  summary String
  oldValue Json?
  newValue Json?
  actorUserId String?
  occurredAt DateTime @default(now())
  @@index([tenantId, itemId, occurredAt])
  @@map("sell_item_events")
}
```

`SellItemEvent` é a timeline **do negócio** (o que o lojista vê). O `AuditLog` continua a ser o registo **técnico** inviolável. São coisas diferentes e as duas são escritas.

## 3.3 Consignação — o que faltava na proposta

Numa loja de segunda mão e antiguidades, **boa parte do stock não é propriedade da loja**. É de terceiros, à consignação, com comissão. Isto muda três coisas: o valor do inventário (peças consignadas não são ativo da loja), a margem (é comissão, não diferença de preço) e a obrigação de acerto de contas com o consignante.

```prisma
model SellConsignment {
  id String @id @default(cuid())
  tenantId String
  consignorCompanyId String            // Company
  reference String
  startedAt DateTime @db.Date
  endsAt DateTime? @db.Date            // findo o prazo, devolver ou renegociar
  commissionPercent Int?               // em pontos percentuais * 100 (ex.: 3000 = 30%)
  commissionFixedCents Int?
  minPriceCents Int?                   // preço abaixo do qual não se vende
  status String @default("ACTIVE")     // ACTIVE | SETTLED | RETURNED | CANCELLED
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
  payoutCents Int?                     // a entregar ao consignante
  settledAt DateTime?
  financeTransactionId String?         // pagamento ao consignante
  @@map("sell_consignment_items")
}
```

Regras de negócio obrigatórias:
- Um artigo com `acquisitionType = CONSIGNMENT` **não entra no valor do inventário** da loja. Nos indicadores, "valor do inventário" separa **próprio** de **consignado**.
- A margem de um artigo consignado é a **comissão**, não `preço − custo`.
- Vender abaixo do `minPriceCents` do contrato exige confirmação explícita e fica auditado.
- Prazo a expirar gera alerta (30/15/7 dias) para devolver ou renegociar.

## 3.4 Canais e publicação

```prisma
model SellChannel {
  id String @id @default(cuid())
  tenantId String
  key String                          // "website" | "olx" | "facebook" | "custom-x"
  name String
  kind String                         // OWNED | MARKETPLACE | SOCIAL
  isActive Boolean @default(true)
  config Json @default("{}")          // credenciais por referência, NUNCA em claro
  capabilities Json @default("{}")    // { canPublish, canUpdate, canUnpublish, manualOnly }
  deletedAt DateTime?
  @@unique([tenantId, key])
  @@map("sell_channels")
}

model SellChannelListing {
  id String @id @default(cuid())
  tenantId String
  itemId String
  channelId String
  externalId String?
  externalUrl String?
  state String @default("DRAFT")      // DRAFT | PUBLISHING | PUBLISHED | UPDATING |
                                      // UNPUBLISHING | UNPUBLISHED | FAILED | MANUAL
  lastSyncedAt DateTime?
  lastError String?
  publishedPriceCents Int?
  @@unique([tenantId, itemId, channelId])
  @@index([tenantId, state])
  @@map("sell_channel_listings")
}

model SellChannelJob {
  id String @id @default(cuid())
  tenantId String
  listingId String
  operation String                    // PUBLISH | UPDATE | UNPUBLISH
  idempotencyKey String
  payload Json
  attempts Int @default(0)
  nextAttemptAt DateTime @default(now())
  state String @default("PENDING")    // PENDING | RUNNING | DONE | FAILED | DEAD
  lastError String?
  createdAt DateTime @default(now())
  @@unique([tenantId, idempotencyKey])
  @@index([state, nextAttemptAt])
  @@map("sell_channel_jobs")
}
```

**Comportamento obrigatório:** quando o estado do artigo passa a `SOLD`, `RESERVED`, `UNAVAILABLE`, `RETURNED` ou `WRITTEN_OFF`, são criados jobs `UNPUBLISH` para **todos** os *listings* ativos, na mesma transação da mudança de estado. Quando volta a `AVAILABLE`, jobs `PUBLISH`. Falha de canal **nunca** impede a mudança de estado interna — fica visível na ficha como "por retirar de X".

Canais sem API disponível ficam com `capabilities.manualOnly = true`: a plataforma prepara o conteúdo, regista onde está anunciado e **avisa** que é preciso retirar à mão. Isto é honestidade de produto, não uma limitação a esconder.

## 3.5 Reservas, vendas e interesses

```prisma
model SellReservation {
  id String @id @default(cuid())
  tenantId String
  itemId String
  companyId String?                   // cliente
  contactName String?
  contactPhone String?
  depositCents Int?
  expiresAt DateTime                  // reserva sem prazo é stock parado disfarçado
  status String @default("ACTIVE")    // ACTIVE | CONVERTED | EXPIRED | CANCELLED
  notes String?
  @@index([tenantId, status, expiresAt])
  @@map("sell_reservations")
}

model SellSale {
  id String @id @default(cuid())
  tenantId String
  code String
  itemId String
  buyerCompanyId String?
  channelId String?                   // onde foi vendido
  priceCents Int
  discountCents Int @default(0)
  paymentMethod String?
  soldAt DateTime @default(now())
  financeTransactionId String?
  invoiceReference String?            // referência ao software de faturação do cliente
  notes String?
  deletedAt DateTime?
  @@unique([tenantId, code])
  @@index([tenantId, soldAt])
  @@map("sell_sales")
}

model SellInterest {                  // "procuro Art Déco até 800 €"
  id String @id @default(cuid())
  tenantId String
  companyId String?
  contactName String?
  contactEmail String?
  contactPhone String?
  typeId String?
  categoryId String?
  keywords String[] @default([])
  period String?
  style String?
  maxPriceCents Int?
  consentAt DateTime?                 // RGPD: sem consentimento não há contacto comercial
  active Boolean @default(true)
  @@index([tenantId, active])
  @@map("sell_interests")
}
```

A correspondência entre uma peça nova e os interesses registados **sugere**, nunca envia sozinha. Nenhuma comunicação comercial sai sem `consentAt` preenchido.

## 3.6 Leilões (Fase 5)

```prisma
model SellAuction {
  id String @id @default(cuid())
  tenantId String
  code String
  title String
  description String?
  startsAt DateTime
  endsAt DateTime
  antiSnipingSeconds Int @default(120)   // prolonga o fecho se houver licitação no fim
  status String @default("DRAFT")        // DRAFT | SCHEDULED | LIVE | CLOSED | CANCELLED
  rulesVersion String?                   // regulamento aceite pelos licitantes
  deletedAt DateTime?
  @@unique([tenantId, code])
  @@map("sell_auctions")
}

model SellAuctionLot {
  id String @id @default(cuid())
  tenantId String
  auctionId String
  itemId String
  lotNumber Int
  startingPriceCents Int
  minIncrementCents Int
  reservePriceCents Int?                 // interno, nunca exposto
  buyNowPriceCents Int?
  currentBidCents Int?
  winnerBidId String?
  status String @default("OPEN")         // OPEN | SOLD | UNSOLD | WITHDRAWN
  closesAt DateTime
  @@unique([tenantId, auctionId, lotNumber])
  @@map("sell_auction_lots")
}

model SellBid {
  id String @id @default(cuid())
  tenantId String
  lotId String
  bidderCompanyId String?
  bidderName String?
  amountCents Int
  placedAt DateTime @default(now())
  state String @default("VALID")         // VALID | OUTBID | WINNING | RETRACTED
  ipAddress String?
  @@index([tenantId, lotId, amountCents])
  @@map("sell_bids")
}
```

> ⚠️ **Concorrência em licitações é o ponto onde estes sistemas partem.** Duas licitações simultâneas pelo mesmo valor não podem ambas ganhar. A inserção de licitação corre em transação com **`SELECT ... FOR UPDATE` sobre o lote** (ou isolamento `SERIALIZABLE` com retry), valida `amount >= currentBid + minIncrement`, atualiza o lote e marca a anterior como `OUTBID` — tudo dentro da mesma transação. Escreve um teste que dispara 50 licitações em paralelo e verifica que existe **exatamente um** vencedor e que a sequência de valores é estritamente crescente.
>
> O fecho do leilão é feito por **cron**, não por temporizador em memória — a Vercel não mantém processos vivos.
>
> Este módulo só arranca depois de o regulamento e as condições de participação estarem validados. Envolve obrigações contratuais reais entre licitante e vendedor.

---

# 4. MÁQUINA DE ESTADOS DO ARTIGO

Uma única função de transição, num só sítio (`SellItemStateService`). Nenhum controller altera `status` diretamente.

```
DRAFT ──────► AVAILABLE ◄─────────────┐
                │  │  │  │             │
                │  │  │  └──► IN_AUCTION ──► SOLD
                │  │  └─────► IN_RESTORATION ┘
                │  └────────► RESERVED ──► SOLD
                │                 └──────► AVAILABLE (reserva expirou/cancelada)
                └───────────► UNAVAILABLE / RETURNED / WRITTEN_OFF
```

Cada transição: valida a origem, exige os campos necessários (não se publica sem preço nem sem fotografia de capa), grava `SellItemEvent`, escreve `AuditLog`, e enfileira os `SellChannelJob` correspondentes — **tudo numa transação**. Transição inválida devolve 409 com explicação, nunca falha em silêncio.

---

# 5. CUSTO REAL, MARGEM E LIGAÇÃO ÀS FINANÇAS

Definições únicas, escritas em `docs/2SELLMAIS_DEFINICOES.md` e cobertas por testes:

- **Custo real** = `acquisitionCents` + Σ `SellItemCost.amountCents` (não anulados).
- **Margem (peça própria)** = `soldPriceCents − totalCostCents`.
- **Margem (peça consignada)** = `commissionCents` (a peça nunca foi ativo da loja).
- **Valor do inventário** = Σ `totalCostCents` dos artigos `AVAILABLE|RESERVED|IN_RESTORATION|IN_AUCTION`, **separado entre próprio e consignado**.
- **Valor potencial** = Σ `askingPriceCents` dos mesmos artigos.
- **Dias parado** = hoje − `availableSince` (não `createdAt`: uma peça que esteve seis meses em restauro não esteve seis meses à venda).
- **Rotação** = artigos vendidos no período ÷ média de artigos disponíveis no período.

**Integração com o módulo financeiro** — opcional por definição do tenant (`sellmais.finance.autoPost`), por omissão **ligada**:

| Evento no 2SELLMAIS | Lançamento em `FinanceTransaction` |
| :--- | :--- |
| Compra de artigo | Despesa, `companyId` = fornecedor, categoria "Aquisições" |
| Custo (transporte, restauro…) | Despesa, ligada ao artigo por `SellItemCost.financeTransactionId` |
| Venda | Receita, `companyId` = comprador |
| Acerto de consignação | Despesa (pagamento ao consignante) |

O lançamento guarda o `id` nos dois sentidos. **Anular um artigo nunca apaga o lançamento financeiro** — cria estorno, com auditoria.

---

# 6. FOTOGRAFIA E IA

Pipeline **assíncrono** (o upload responde depressa; o tratamento acontece a seguir e a ficha atualiza-se).

**Imagem:** melhorar iluminação e nitidez, corrigir enquadramento e perspetiva, remover ou substituir fundo, uniformizar, gerar derivadas por canal.

> **Princípio de integridade — não é configurável.** O tratamento melhora as condições de captação; **não altera a peça**. Não remove defeitos, marcas de uso, riscos ou danos. O original fica sempre guardado e acessível. Um comprador que receba uma peça diferente da fotografia é uma devolução, uma reclamação e uma reputação.

**Descrição:** a partir das fotografias e dos atributos, o sistema propõe uma primeira versão. Ações: **aceitar / editar / regenerar**. Nada é publicado sem validação humana.

Guarda, por descrição gerada: modelo usado, versão do prompt, texto original proposto, texto final, e quem aprovou. Sem isto não há como auditar uma descrição que venha a ser contestada.

> **Distinção obrigatória entre facto e estimativa.** `SellProvenance.confidence` e os atributos marcados como estimados têm de aparecer na interface e no texto gerado. **Autenticidade, época, autoria e atribuição nunca são afirmadas como facto** enquanto não forem confirmadas por quem tem competência para o fazer. A IA escreve "atribuível a", "estilo", "aproximadamente" — nunca "original de" sobre informação não confirmada. Isto protege o lojista de uma disputa de venda.

Custos de IA são consumo real: regista chamadas e custo por tenant, e respeita os `limits` do plano no `EntitlementService`.

---

# 7. FRONTEND

Vista `#/sellmais` em `app.html`, com sub-navegação:

```
Visão Geral · Artigos · Novo Artigo · Consignações · Canais
Leilões · Clientes & Interesses · Localizações · Documentos · Configuração
```

**Regras de interface, sem exceções:**

1. **Zero emojis.** Ícones SVG inline. É regra do `AGENTS.md` §4 — e o `app.html` já tem 50 emojis a corrigir; não acrescentes mais.
2. **Tokens do design system.** Nada de `:root` inline a redefinir cores, como aconteceu no módulo financeiro.
3. **Proibido `.catch(fallback)`.** Um 403 mostra "módulo não licenciado", um 401 leva ao login, um 500 mostra o `requestId`. O padrão de tentar um endpoint e cair noutro em silêncio foi o que tornou os números do módulo financeiro impossíveis de confiar.
4. **Sem `prompt()`, `confirm()` ou `alert()`.** Modais próprios, com foco preso e `Esc`.
5. **Registo rápido em telemóvel** — é o ecrã mais importante do módulo: fotografar, título, tipo, preço de compra, gravar. Tudo o resto fica para depois, com o indicador de completude a puxar.
6. **Undo de 10 s** em qualquer eliminação (soft delete torna-o trivial).
7. **Tabelas** com cabeçalho fixo, filtros persistentes no URL, seleção múltipla e ações em lote (publicar, mudar preço, mover de localização).
8. **Estados vazios desenhados** e **skeletons** no carregamento.
9. **Paridade i18n pt/en** 1:1 em `locales/` — há um teste que a verifica (`tests/public/translationParity.test.ts`); não o partas.

---

# 8. PERMISSÕES

Usa `Role` / `RolePermissionLink` / `Permission` — já existem. Popula o catálogo:

| Permissão | Quem a tem tipicamente |
| :--- | :--- |
| `sellmais.item.read` | Todos os utilizadores do módulo |
| `sellmais.item.write` | Colaborador de loja |
| `sellmais.item.delete` | Responsável |
| `sellmais.cost.read` | **Só responsável** — inclui preço de aquisição e margem |
| `sellmais.price.write` | Responsável |
| `sellmais.channel.publish` | Gestão de conteúdos |
| `sellmais.consignment.manage` | Responsável |
| `sellmais.auction.manage` | Responsável |
| `sellmais.admin` | Proprietário |

**`sellmais.cost.read` é a permissão crítica.** Sem ela, a API **não devolve** `acquisitionCents`, `extraCostsCents`, `totalCostCents`, `minPriceCents` nem margem — filtrado no servidor, não escondido no ecrã. Um colaborador não tem de saber por quanto a peça foi comprada.

---

# 9. DADOS PÚBLICOS vs INTERNOS

Lista branca explícita do que sai para o catálogo público e para os canais:

**Público:** título, descrição, tipo, categoria, atributos com `showInPublic`, época, estilo, material, dimensões, estado de conservação, fotografias `isPublic`, preço pedido, disponibilidade, proveniência **só se** `SellProvenance.isPublic = true`.

**Nunca público:** preço de aquisição, custos, margem, preço mínimo, preço de reserva de leilão, fornecedor, consignante, comissões, notas internas, localização física, dados de outros clientes.

Escreve um **teste que falha** se um campo interno aparecer numa resposta pública. É mais barato do que descobrir pelo cliente.

---

# 10. CONFORMIDADE — LER ANTES DA FASE 1

Estes pontos não são detalhes de implementação; são requisitos que podem mudar o modelo de dados.

**Compra de bens usados a particulares.** Em Portugal, quem compra bens em segunda mão a particulares está sujeito a obrigações de registo das aquisições, e o comércio de **metais preciosos, ouro e joalharia** tem regras próprias, incluindo identificação do vendedor e deveres no âmbito da prevenção do branqueamento de capitais. Não sou jurista e isto **tem de ser confirmado pelo contabilista ou jurista do cliente** — mas o sistema deve estar preparado:

- Bloco de **identificação do vendedor** na aquisição, ativável por definição do tenant (`sellmais.acquisition.requireSellerId`): nome, documento de identificação, data, morada, declaração de propriedade.
- **Livro de registo de aquisições** exportável, com numeração sequencial e sem lacunas.
- Estes campos são **dados pessoais sensíveis**: acesso restrito a `sellmais.admin`, cifrados em repouso, e nunca incluídos em exportações genéricas.

**RGPD.** Consentimento registado para comunicações comerciais (`SellInterest.consentAt`), direito de acesso e de eliminação, registo de quem acedeu a dados de clientes. O módulo financeiro tem hoje um endpoint de anonimização perigoso — **não copies esse padrão**: qualquer anonimização é dirigida a um titular identificado, exige permissão de administração e confirmação explícita, e fica auditada.

**Margem de lucro (regime especial de tributação de bens em segunda mão).** Em Portugal existe um regime de IVA sobre a margem aplicável a bens em segunda mão, antiguidades e objetos de coleção. O 2SELLMAIS **não faz faturação nem apuramento fiscal**, mas deve guardar a informação que o contabilista precisa: base de aquisição, base de venda, e se o artigo está sob regime de margem (`sellmais.vat.marginScheme`, marcável por artigo). Confirmar com contabilista.

---

# 11. OS ERROS DO MÓDULO FINANCEIRO QUE NÃO SE REPETEM

Checklist de verificação. Cada linha foi um defeito real encontrado neste repositório:

- [ ] Todas as rotas têm `app.authenticate` **e** `app.requireApp('sellmais')`.
- [ ] Nenhum acesso a `prisma` cru; tudo via `forTenant()`.
- [ ] Todos os modelos novos registados em `TENANT_SCOPED_MODELS`.
- [ ] Zero `delete` físico; tudo `deletedAt`; todas as leituras filtram `deletedAt: null`.
- [ ] Todos os valores em cêntimos inteiros; zero `Float`.
- [ ] Todas as restrições de unicidade incluem `tenantId`.
- [ ] Nenhum GET com efeito secundário (o `listCategories` financeiro semeia dados num GET — não repetir).
- [ ] Nenhuma listagem sem `take`/paginação (máx. 200).
- [ ] Dashboard com ≤ 4 queries; séries temporais por `GROUP BY`, não 12 agregações em ciclo.
- [ ] Validação Zod estrita em todos os endpoints; **zero `as any`**; input inválido devolve 400 com os valores aceites — nunca "adivinha" um valor por omissão.
- [ ] Uma só definição de cada indicador, num só serviço.
- [ ] Nenhum `.catch(fallback)` no frontend.
- [ ] Uma só chave de módulo, sem aliases.
- [ ] Endpoints do frontend conferidos contra as rotas reais do backend (o financeiro chamava `/cashflow/projections` quando a rota era `/cashflow/projection`).
- [ ] Exportações CSV com BOM UTF-8 e separador `;`.

---

# 12. ORDEM DE EXECUÇÃO

Cada fase acaba com `npm run verify` verde, commit próprio e `DIARIO.md` atualizado.

**Fase 0 — Auditoria e plano.** Sem código. Confirmar o estado atual do schema e dos módulos, decidir armazenamento de ficheiros e mecanismo de cron, mapear a ligação a `Company` e a `FinanceTransaction`. Entregar `docs/2SELLMAIS_PLANO.md`.

**Fase 1 — Fundação.** Registo do módulo (`Module`, manifesto, seed, `requireApp`, permissões, entrada no launcher). Schema: `SellItemType`, `SellItem`, `SellItemCost`, `SellLocation`, `SellItemEvent`, `SellCounter`. CRUD completo, máquina de estados, custo real e margem, timeline. Ecrã de artigos e registo rápido em telemóvel. **No fim desta fase o cliente já consegue usar o sistema.**

**Fase 2 — Proveniência, media e restauro.** Provenência com nível de confiança, media com originais preservados, restauros com custos a entrar no custo real, documentos com validade e alertas.

**Fase 3 — Consignação e clientes.** Contratos de consignação, comissões, acertos, alertas de prazo. Interesses de clientes e correspondência com peças novas. Separação de inventário próprio vs consignado nos indicadores.

**Fase 4 — Catálogo público.** Páginas com HTML gerado no servidor, SEO, Open Graph, JSON-LD, sitemap, pesquisa e filtros, reservas online. Lista branca de campos públicos com teste.

**Fase 5 — IA.** Pipeline assíncrono de imagem e descrições, com registo de proveniência do texto gerado e limites por plano.

**Fase 6 — Canais.** `SellChannel`, `SellChannelListing`, outbox, worker por cron, adaptadores, retiradas automáticas, modo manual honesto para canais sem API.

**Fase 7 — Leilões.** Só depois do regulamento validado. Com o teste de concorrência de licitações a passar.

**Fase 8 — Painel, alertas e relatórios.** Indicadores, rotação, artigos parados com sugestões, margem por categoria e por canal, exportações.

**Fase 9 — QA visual e documentação.** Playwright em desktop e telemóvel, screenshots, correções, e atualização de `docs/MODULOS.md`, `ESTADO.md`, `docs/INVENTARIO.md` e `qa/CONTRATO.md` para descreverem o que **existe**.

---

# 13. TESTES OBRIGATÓRIOS

**Isolamento:** tenant A não lê nem escreve nada do tenant B, em todos os endpoints; sem licença → 403 `APP_NOT_LICENSED`; sem `sellmais.cost.read` → resposta sem campos de custo.

**Integridade:** custo real = aquisição + custos; margem própria vs consignada; soft delete não reduz contagem na BD e o restauro repõe; código de artigo único sob 100 criações concorrentes; estorno financeiro ao anular artigo.

**Estados:** todas as transições válidas passam, todas as inválidas devolvem 409; publicar sem preço ou sem foto de capa é recusado; passar a `SOLD` cria jobs de despublicação para todos os canais ativos.

**Canais:** job repetido com a mesma `idempotencyKey` não duplica anúncio; falha de canal não impede a venda; canal `manualOnly` gera aviso em vez de job.

**Leilões:** 50 licitações concorrentes → um vencedor, valores estritamente crescentes; anti-sniping prolonga o fecho; preço de reserva nunca aparece em nenhuma resposta pública.

**Público:** nenhuma resposta pública contém campos internos (teste por lista branca).

**Interface:** percurso completo em desktop e telemóvel; zero erros de consola; zero emojis no HTML renderizado; paridade pt/en.

**Verificação final:** correr a aplicação, abrir cada ecrã e **comparar os números do painel com uma query SQL direta**. Se não bater, não está pronto — mesmo que compile.

---

# 14. FORA DE ÂMBITO

Faturação certificada e comunicação à AT · contabilidade organizada · processamento direto de pagamentos · peritagem ou autenticação de peças · integração com transportadoras · marketplace próprio · aplicação móvel nativa.

---

# 15. RELATÓRIO FINAL

`docs/RELATORIO_2SELLMAIS.md` com: o que foi criado ficheiro a ficheiro; migrações aplicadas com contagens antes/depois; testes executados e resultado; decisões tomadas e porquê; o que ficou por fazer; dívida técnica criada — declarada em `DIVIDA_TECNICA.md`, não escondida; e recomendações para a versão seguinte.

---

# 16. REGRA FINAL

O 2SELLMAIS não é um catálogo de artigos. É o sistema onde uma peça entra pela porta e sai vendida, com a sua história, os seus custos, a sua localização e o seu percurso preservados.

Três coisas têm de ser verdade no fim, e são elas que definem se o módulo está pronto:

1. **Uma peça pode ser registada em menos de dois minutos, no telemóvel, em cima do balcão.** Se for preciso ir ao computador, ninguém a regista.
2. **O que o painel mostra é o que a base de dados tem.** Sem exceções, sem arredondamentos convenientes, sem duas definições do mesmo número.
3. **Nenhuma peça vendida continua anunciada em lado nenhum** — e onde a plataforma não puder retirar sozinha, avisa em vez de fingir que retirou.

E, acima de tudo: **se em algum momento não conseguires garantir que nenhum dado se perde, para e reporta.** Um inventário de antiguidades é o registo de peças que muitas vezes não têm substituto.
