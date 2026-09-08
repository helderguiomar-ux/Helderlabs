# PLANO DE EXECUÇÃO — HELDERLABS ERP v0.5.0
## Módulos: **HCCALL Telecom** (`hccall`) · **2SELLMAIS** (`sellmais`)

> **Diretoria canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Versão Alvo:** v0.5.0 · **Fase:** 0 (Auditoria & Plano Arquitetural)
> **Data:** 2026-09-08

---

## 1. REGRAS ARQUITETURAIS TRANSVERSAIS (PARTE I)

### 1.1 Hierarquia de 5 Camadas
1. **Plataforma:** Catálogo global `Module` gerido por `SUPER_ADMIN` / `PLATFORM_ADMIN`.
2. **Tenant:** `Tenant` + `TenantBranding` + `TenantSetting`. O `tenantId` provém estritamente de `request.user.tenantId`.
3. **Licença:** `ApplicationInstance` (tenant × módulo).
4. **Atribuição:** `ApplicationAssignment` (utilizador × licença).
5. **Módulo:** Entidades de negócio com `tenantId`, protegidas por `app.authenticate` + `app.requireApp('<chave>')` (+ `app.requirePermission`).

### 1.2 Isolamento de Dados & Prisma 5
- Zero Drizzle: O repositório utiliza **Prisma 5**.
- PostgreSQL RLS **não** está ativo para a ligação da app (utilizador dono das tabelas ignora RLS); o isolamento real é a Prisma Client Extension `tenantScopedClient.ts`.
- Todos os novos modelos com `tenantId` entram imediatamente em `TENANT_SCOPED_MODELS`.
- Zero acesso direto a `prisma` cru fora do contexto tenant-scoped.
- Todo o dinheiro é `Int` em cêntimos inteiros (`*Cents`). Zero `Float`.
- Restrições de unicidade incluem sempre `tenantId` (`@@unique([tenantId, ...])`).
- Contadores sequenciais atómicos por tenant/ano com `UPDATE ... RETURNING` (`HccallCounter`, `SellCounter`).
- Eliminação lógica (`deletedAt`) em todas as entidades; leituras filtram `deletedAt: null`.
- Auditoria transversal com encadeamento SHA-256 via `AuditService`.

---

## 2. MÓDULO HCCALL TELECOM (`hccall`) — PARTE II

### 2.1 Visão Geral & Modelo Operacional
- **Público:** Operadores de call center e vendedores de loja de telecomunicações.
- **Interface:** Mobile-first PWA dedicado (`backend/public/hccall.html`), alvos de toque ≥ 44px, operação com 1 mão ao telefone, registo de nova venda em <20 segundos e <8 toques, ícones SVG inline.
- **Papel Único & Visibilidade:** Papel funcional único `hccall.user` (sem hierarquia supervisor/gestor no módulo). Visibilidade definida por `TenantSetting hccall.visibility` (`OWN` por omissão, filtrando `ownerUserId = request.user.sub`; ou `TEAM` para toda a equipa).

### 2.2 Modelos de Dados Prisma (`hccall`)
```prisma
model HccallCustomer {
  id             String    @id @default(cuid())
  tenantId       String
  ownerUserId    String
  customerNumber String
  name           String?
  phone          String?
  notes          String?
  deletedAt      DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@unique([tenantId, customerNumber])
  @@index([tenantId, ownerUserId])
  @@map("hccall_customers")
}

model HccallService {
  id          String    @id @default(cuid())
  tenantId    String
  ownerUserId String
  name        String
  color       String?
  sortOrder   Int       @default(100)
  active      Boolean   @default(true)
  deletedAt   DateTime?

  @@unique([tenantId, name])
  @@map("hccall_services")
}

model HccallPromotion {
  id                       String    @id @default(cuid())
  tenantId                 String
  ownerUserId              String
  name                     String
  description              String?
  serviceId                String?
  suggestedCommissionCents Int       @default(0)
  promoValueCents          Int?
  startsAt                 DateTime? @db.Date
  endsAt                   DateTime? @db.Date
  active                   Boolean   @default(true)
  notes                    String?
  version                  Int       @default(1)
  deletedAt                DateTime?

  @@index([tenantId, active])
  @@map("hccall_promotions")
}

model HccallSaleStatus {
  id              String    @id @default(cuid())
  tenantId        String
  key             String
  label           String
  color           String?
  sortOrder       Int       @default(100)
  isTerminal      Boolean   @default(false)
  commissionState String    @default("FORECAST") // FORECAST | CONFIRMED | PAID | VOID
  isSystem        Boolean   @default(false)
  deletedAt       DateTime?

  @@unique([tenantId, key])
  @@map("hccall_sale_statuses")
}

model HccallSale {
  id                String    @id @default(cuid())
  tenantId          String
  ownerUserId       String
  code              String
  clientUuid        String
  customerId        String?
  customerNumber    String
  serviceId         String?
  serviceName       String
  promotionId       String?
  promotionName     String?
  promotionVersion  Int?
  promotionSnapshot Json?
  commissionCents   Int
  saleValueCents    Int?
  statusId          String
  soldAt            DateTime  @db.Date
  notes             String?
  deletedAt         DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([tenantId, code])
  @@unique([tenantId, clientUuid])
  @@index([tenantId, ownerUserId, soldAt])
  @@index([tenantId, statusId])
  @@map("hccall_sales")
}

model HccallSaleChange {
  id              String   @id @default(cuid())
  tenantId        String
  saleId          String
  field           String
  oldValue        String?
  newValue        String?
  reason          String?
  changedByUserId String
  changedAt       DateTime @default(now())

  @@index([tenantId, saleId, changedAt])
  @@map("hccall_sale_changes")
}

model HccallContact {
  id          String    @id @default(cuid())
  tenantId    String
  ownerUserId String
  customerId  String
  kind        String    // CALL | STORE | MESSAGE | NOTE
  summary     String
  occurredAt  DateTime  @default(now())
  deletedAt   DateTime?

  @@index([tenantId, customerId, occurredAt])
  @@map("hccall_contacts")
}

model HccallCounter {
  tenantId String
  year     Int
  scope    String    // "sale"
  value    Int       @default(0)

  @@id([tenantId, year, scope])
  @@map("hccall_counters")
}
```

### 2.3 Regras de Negócio Críticas (`hccall`)
1. **Regra de Ouro da Comissão:** A dinamização sugere, a venda grava. `HccallPromotion.suggestedCommissionCents` é apenas valor sugerido. No registo, a venda grava `commissionCents` e o `promotionSnapshot` JSON completo. Mudar a promoção nunca altera vendas passadas.
2. **Motor Offline-First:**
   - Escrita local com UUID v4 gerado no cliente (`clientUuid`).
   - Sincronização via `POST /api/hccall/sync` protegida por `@@unique([tenantId, clientUuid])`.
   - Conflitos: servidor ganha e notifica cliente.
   - Sobrevivência à expiração de token JWT (8h): a fila permanece intacta no IndexedDB, solicita nova autenticação e só depois envia o lote.
3. **RGPD & Minimização:** Suporte a `hccall.customerRef.mode` (`FULL` vs `HASHED`), anonimização direcionada por cliente com auditoria SHA-256.

---

## 3. MÓDULO 2SELLMAIS (`sellmais`) — PARTE III

### 3.1 Visão Geral & Reutilização
- **Público:** Lojas de antiguidades, galerias, comércio de artigos em 2ª mão e leilões.
- **Reutilização Integral:**
  - `Company` para fornecedores, consignantes e compradores.
  - `FinanceTransaction` para lançamentos automáticos de aquisições, custos e vendas.
  - `Role` e `RolePermissionLink` para controlo fino de permissões (`sellmais.cost.read`, `sellmais.price.write`, etc.).

### 3.2 Modelos de Dados Prisma (`sellmais`)
```prisma
enum SellItemStatus {
  DRAFT
  AVAILABLE
  RESERVED
  IN_RESTORATION
  IN_AUCTION
  SOLD
  RETURNED
  UNAVAILABLE
  WRITTEN_OFF
}

enum SellAcquisitionType {
  PURCHASE
  CONSIGNMENT
  TRADE_IN
  DONATION
}

model SellItemType {
  id        String    @id @default(cuid())
  tenantId  String
  key       String    // "mobiliario" | "pintura" | "joia" | "relogio" | "vinil"
  name      String
  icon      String?
  fields    Json      // [{ key, label, type, required, options[], unit, showInPublic }]
  isSystem  Boolean   @default(false)
  deletedAt DateTime?

  @@unique([tenantId, key])
  @@map("sell_item_types")
}

model SellItem {
  id               String              @id @default(cuid())
  tenantId         String
  code             String
  slug             String
  typeId           String
  title            String
  shortDescription String?
  description      String?
  attributes       Json                @default("{}")
  categoryId       String?
  period           String?
  style            String?
  material         String?
  maker            String?
  conditionGrade   String?
  conditionNotes   String?
  dimensions       Json?
  quantity         Int                 @default(1)
  isUnique         Boolean             @default(true)
  status           SellItemStatus      @default(DRAFT)
  acquisitionType  SellAcquisitionType @default(PURCHASE)
  acquisitionCents Int                 @default(0)
  extraCostsCents  Int                 @default(0)
  totalCostCents   Int                 @default(0)
  askingPriceCents Int?
  minPriceCents    Int?
  soldPriceCents   Int?
  supplierCompanyId String?
  buyerCompanyId   String?
  assignedUserId   String?
  locationId       String?
  publishedAt      DateTime?
  availableSince   DateTime?
  soldAt           DateTime?
  tags             String[]            @default([])
  internalNotes    String?
  vatMarginScheme  Boolean             @default(false)
  deletedAt        DateTime?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  costs            SellItemCost[]
  media            SellItemMedia[]
  provenance       SellProvenance?
  restorations     SellRestoration[]
  events           SellItemEvent[]

  @@unique([tenantId, code])
  @@unique([tenantId, slug])
  @@index([tenantId, status, availableSince])
  @@index([tenantId, deletedAt])
  @@map("sell_items")
}

model SellItemCost {
  id                   String    @id @default(cuid())
  tenantId             String
  itemId               String
  item                 SellItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)
  category             String    // TRANSPORT | RESTORATION | APPRAISAL | COMMISSION | TAX | OTHER
  description          String
  amountCents          Int
  date                 DateTime  @db.Date
  supplierCompanyId    String?
  financeTransactionId String?
  deletedAt            DateTime?
  createdAt            DateTime  @default(now())

  @@index([tenantId, itemId])
  @@map("sell_item_costs")
}

model SellItemMedia {
  id           String    @id @default(cuid())
  tenantId     String
  itemId       String
  item         SellItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)
  url          String
  storageKey   String
  mimeType     String
  sizeBytes    Int
  checksumSha256 String
  isCover      Boolean   @default(false)
  sortOrder    Int       @default(100)
  caption      String?
  deletedAt    DateTime?
  createdAt    DateTime  @default(now())

  @@index([tenantId, itemId])
  @@map("sell_item_media")
}

model SellProvenance {
  id          String   @id @default(cuid())
  tenantId    String
  itemId      String   @unique
  item        SellItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  description String
  confidence  String   @default("UNVERIFIED") // CONFIRMED | ESTIMATED | UNVERIFIED
  isPublic    Boolean  @default(false)
  documents   Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("sell_provenances")
}

model SellRestoration {
  id            String    @id @default(cuid())
  tenantId      String
  itemId        String
  item          SellItem  @relation(fields: [itemId], references: [id], onDelete: Cascade)
  restorerName  String
  description   String
  costCents     Int       @default(0)
  startedAt     DateTime? @db.Date
  completedAt   DateTime? @db.Date
  status        String    @default("IN_PROGRESS") // PLANNED | IN_PROGRESS | COMPLETED
  beforeMediaId String?
  afterMediaId  String?
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())

  @@index([tenantId, itemId])
  @@map("sell_restorations")
}

model SellLocation {
  id          String    @id @default(cuid())
  tenantId    String
  parentId    String?
  name        String
  path        String    // Materialized: "Loja > Sala 2 > Zona B > Estante 4"
  deletedAt   DateTime?

  @@index([tenantId, parentId])
  @@map("sell_locations")
}

model SellItemEvent {
  id          String   @id @default(cuid())
  tenantId    String
  itemId      String
  item        SellItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  eventType   String   // CREATED | STATUS_CHANGE | PRICE_CHANGE | RESTORATION | LISTED | SOLD
  fromState   String?
  toState     String?
  description String
  actorUserId String
  createdAt   DateTime @default(now())

  @@index([tenantId, itemId, createdAt])
  @@map("sell_item_events")
}

model SellConsignment {
  id                 String    @id @default(cuid())
  tenantId           String
  consignorCompanyId String
  reference          String
  startedAt          DateTime  @db.Date
  endsAt             DateTime? @db.Date
  commissionPercent  Int?      // Centésimas de % (3000 = 30.00%)
  commissionFixedCents Int?
  minPriceCents      Int?
  status             String    @default("ACTIVE") // ACTIVE | SETTLED | RETURNED | CANCELLED
  settlementNotes    String?
  deletedAt          DateTime?

  items              SellConsignmentItem[]

  @@unique([tenantId, reference])
  @@map("sell_consignments")
}

model SellConsignmentItem {
  id                   String          @id @default(cuid())
  tenantId             String
  consignmentId        String
  consignment          SellConsignment @relation(fields: [consignmentId], references: [id], onDelete: Cascade)
  itemId               String          @unique
  agreedPriceCents     Int?
  soldPriceCents       Int?
  commissionCents      Int?
  payoutCents          Int?
  settledAt            DateTime?
  financeTransactionId String?

  @@map("sell_consignment_items")
}

model SellChannel {
  id           String    @id @default(cuid())
  tenantId     String
  key          String    // "olx" | "standvirtual" | "1stdibs" | "ebay" | "website"
  name         String
  manualOnly   Boolean   @default(true)
  config       Json?
  active       Boolean   @default(true)
  deletedAt    DateTime?

  @@unique([tenantId, key])
  @@map("sell_channels")
}

model SellChannelListing {
  id           String    @id @default(cuid())
  tenantId     String
  itemId       String
  channelId    String
  externalId   String?
  status       String    @default("PENDING") // PENDING | PUBLISHED | FAILED | UNPUBLISHED
  listingUrl   String?
  lastSyncAt   DateTime?
  lastError    String?

  @@unique([tenantId, itemId, channelId])
  @@map("sell_channel_listings")
}

model SellChannelJob {
  id             String    @id @default(cuid())
  tenantId       String
  idempotencyKey String
  itemId         String
  channelId      String
  action         String    // PUBLISH | UPDATE | UNPUBLISH
  payload        Json?
  status         String    @default("PENDING") // PENDING | PROCESSING | COMPLETED | FAILED
  attempts       Int       @default(0)
  lastError      String?
  scheduledFor   DateTime  @default(now())
  createdAt      DateTime  @default(now())

  @@unique([tenantId, idempotencyKey])
  @@index([tenantId, status, scheduledFor])
  @@map("sell_channel_jobs")
}

model SellAuction {
  id          String           @id @default(cuid())
  tenantId    String
  title       String
  code        String
  startsAt    DateTime
  endsAt      DateTime
  status      String           @default("SCHEDULED") // SCHEDULED | ACTIVE | CLOSED | CANCELLED
  terms       String?
  deletedAt   DateTime?
  createdAt   DateTime         @default(now())

  lots        SellAuctionLot[]

  @@unique([tenantId, code])
  @@map("sell_auctions")
}

model SellAuctionLot {
  id               String        @id @default(cuid())
  tenantId         String
  auctionId        String
  auction          SellAuction   @relation(fields: [auctionId], references: [id], onDelete: Cascade)
  itemId           String        @unique
  lotNumber        Int
  startingBidCents Int
  reservePriceCents Int?         // NUNCA PÚBLICO
  minIncrementCents Int          @default(500) // 5.00 EUR
  currentBidCents  Int           @default(0)
  winningBidId     String?
  status           String        @default("PENDING") // PENDING | ACTIVE | SOLD | UNSOLD

  bids             SellBid[]

  @@unique([auctionId, lotNumber])
  @@map("sell_auction_lots")
}

model SellBid {
  id          String         @id @default(cuid())
  tenantId    String
  lotId       String
  lot         SellAuctionLot @relation(fields: [lotId], references: [id], onDelete: Cascade)
  bidderId    String
  amountCents Int
  status      String         @default("VALID") // VALID | OUTBID | CANCELLED
  createdAt   DateTime       @default(now())

  @@index([tenantId, lotId, amountCents])
  @@map("sell_bids")
}

model SellCounter {
  tenantId String
  year     Int
  scope    String    // "item" | "auction"
  value    Int       @default(0)

  @@id([tenantId, year, scope])
  @@map("sell_counters")
}
```

### 3.3 Regras de Negócio Críticas (`sellmais`)
1. **Materialização de Custos e Margem:** `extraCostsCents` e `totalCostCents` são recalculados na mesma transação atómica em que um custo entra ou é anulado.
2. **Máquina de Estados & Outbox:** `SellItemStateService` gere todas as transações de ciclo de vida. Mudar para `SOLD`, `RESERVED`, etc., agenda imediatamente jobs `UNPUBLISH` na tabela outbox `SellChannelJob`.
3. **Catálogo Público SSR com Whitelist Estrita:** Rotas `/loja` e `/loja/artigo/:slug` geradas em Fastify com HTML, OpenGraph, JSON-LD `Product`. Dados internos como `acquisitionCents`, `minPriceCents`, fornecedor e margem nunca são emitidos.
4. **Concorrência em Licitações de Leilão:** Transações de licitação executadas com lock/serializabilidade sobre o lote, garantindo 1 único vencedor e ordem estritamente crescente sob 50 licitações concorrentes.

---

## 4. CHECKLIST DE 10 PASSOS DE REGISTO

Para **cada um** dos dois módulos (`hccall` e `sellmais`):
- [ ] 1. `module.manifest.ts` criado com `key`, `name`, `icon`, `color`, `routePrefix`, `frontendEntry`, `permissions`, `features`, `defaultLimits`.
- [ ] 2. Linha em `seed.ts` para a tabela `Module` com a chave exata.
- [ ] 3. Registo de rotas em `app.ts` (`/api/hccall` e `/api/sellmais`).
- [ ] 4. `app.authenticate` + `app.requireApp('<chave>')` em **todas** as rotas do módulo.
- [ ] 5. Permissões criadas em `Permission` e associadas aos perfis em `RolePermissionLink`.
- [ ] 6. Todos os novos modelos adicionados a `TENANT_SCOPED_MODELS` em `tenantScopedClient.ts`.
- [ ] 7. Entrada registada em `window.MODULES_REGISTRY` (`assets/js/modules.js`).
- [ ] 8. Chaves de tradução adicionadas com paridade 1:1 em `locales/pt.json` e `locales/en.json`.
- [ ] 9. Migração Prisma aditiva gerada com `prisma migrate`.
- [ ] 10. Testes automatizados unitários, de integração e de isolamento multi-tenant em `tests/<chave>/`.

---

## 5. ROTEIRO DE FASES E ORDEM DE EXECUÇÃO

| Fase | Módulo | Foco |
| :--- | :--- | :--- |
| **0** | Ambos | Plano e auditoria arquitetural (concluído neste documento). |
| **1** | HCCALL | Registo do módulo, schema Prisma, `tenantScopedClient.ts`, contadores atómicos, serviços de serviços/dinamizações/estados. |
| **2** | HCCALL | Motor de vendas, snapshot imutável de comissões, histórico de alterações `HccallSaleChange`. |
| **3** | HCCALL | Interface mobile-first PWA `hccall.html`, início rápido, nova venda em <20s, configuração. |
| **4** | HCCALL | Motor offline IndexedDB, endpoint `POST /api/hccall/sync` idempotente, resolução de conflitos, re-autenticação. |
| **5** | HCCALL | Clientes, contactos, relatórios por `commissionState`, exportações CSV com BOM UTF-8 e `;`. |
| **6** | 2SELLMAIS | Registo do módulo, schema Prisma, `SellItemType`, `SellItem`, custos, localizações, máquina de estados `SellItemStateService`. |
| **7** | 2SELLMAIS | Proveniência, restauros, media com checksum SHA-256. |
| **8** | 2SELLMAIS | Consignações, separação de inventário próprio vs consignado, acertos financeiros. |
| **9** | 2SELLMAIS | Catálogo público SSR (`/loja`, `/loja/artigo/:slug`), SEO, OpenGraph, proteção de dados internos por whitelist. |
| **10** | 2SELLMAIS | IA de sugestão de descrições e análise de atributos (com registo de modelo, prompt e aprovação humana). |
| **11** | 2SELLMAIS | Canais de venda, outbox `SellChannelJob`, despublicação automática em venda. |
| **12** | 2SELLMAIS | Motor de leilões e licitações concorrentes. |
| **13** | Ambos | Dashboards analíticos, KPIs de rentabilidade e rotação, relatórios. |
| **14** | Ambos | QA visual, testes E2E, paridade de traduções e sincronização de documentação. |
