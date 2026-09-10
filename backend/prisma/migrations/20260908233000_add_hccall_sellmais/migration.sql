-- ============================================================================
-- MIGRATION: 20260908233000_add_hccall_sellmais
-- Add HCCALL Telecom and 2SELLMAIS Modules
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SellItemStatus" AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'IN_RESTORATION', 'IN_AUCTION', 'SOLD', 'RETURNED', 'UNAVAILABLE', 'WRITTEN_OFF');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SellAcquisitionType" AS ENUM ('PURCHASE', 'CONSIGNMENT', 'TRADE_IN', 'DONATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "HccallCommissionState" AS ENUM ('FORECAST', 'CONFIRMED', 'PAID', 'VOID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------------------
-- HCCALL TELECOM TABLES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "hccall_customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hccall_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hccall_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_promotions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serviceId" TEXT,
    "suggestedCommissionCents" INTEGER NOT NULL DEFAULT 0,
    "promoValueCents" INTEGER,
    "startsAt" DATE,
    "endsAt" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hccall_promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_sale_statuses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "commissionState" TEXT NOT NULL DEFAULT 'FORECAST',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hccall_sale_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "customerId" TEXT,
    "customerNumber" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceName" TEXT NOT NULL,
    "promotionId" TEXT,
    "promotionName" TEXT,
    "promotionVersion" INTEGER,
    "promotionSnapshot" JSONB,
    "commissionCents" INTEGER NOT NULL,
    "saleValueCents" INTEGER,
    "statusId" TEXT NOT NULL,
    "soldAt" DATE NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hccall_sales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_sale_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "oldCommissionCents" INTEGER,
    "newCommissionCents" INTEGER,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hccall_sale_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hccall_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "hccall_counters" (
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hccall_counters_pkey" PRIMARY KEY ("tenantId","year","scope")
);

-- ----------------------------------------------------------------------------
-- 2SELLMAIS TABLES
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sell_item_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "fields" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_item_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "attributes" JSONB NOT NULL,
    "categoryId" TEXT,
    "period" TEXT,
    "style" TEXT,
    "material" TEXT,
    "maker" TEXT,
    "conditionGrade" TEXT,
    "conditionNotes" TEXT,
    "dimensions" JSONB,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isUnique" BOOLEAN NOT NULL DEFAULT true,
    "status" "SellItemStatus" NOT NULL DEFAULT 'DRAFT',
    "acquisitionType" "SellAcquisitionType" NOT NULL DEFAULT 'PURCHASE',
    "acquisitionCents" INTEGER NOT NULL DEFAULT 0,
    "extraCostsCents" INTEGER NOT NULL DEFAULT 0,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "askingPriceCents" INTEGER,
    "minPriceCents" INTEGER,
    "soldPriceCents" INTEGER,
    "soldAt" TIMESTAMP(3),
    "buyerCompanyId" TEXT,
    "supplierCompanyId" TEXT,
    "assignedUserId" TEXT,
    "locationId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "internalNotes" TEXT,
    "vatMarginScheme" BOOLEAN NOT NULL DEFAULT false,
    "availableSince" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_item_costs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "supplierCompanyId" TEXT,
    "financeTransactionId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_item_costs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_item_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "caption" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_item_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_provenances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "documents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_provenances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_restorations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "restorerName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATE,
    "completedAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "beforeMediaId" TEXT,
    "afterMediaId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_restorations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_item_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "description" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_item_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_consignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consignorCompanyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "startedAt" DATE NOT NULL,
    "endsAt" DATE,
    "commissionPercent" INTEGER,
    "commissionFixedCents" INTEGER,
    "minPriceCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "settlementNotes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_consignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_consignment_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consignmentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "agreedPriceCents" INTEGER,
    "soldPriceCents" INTEGER,
    "commissionCents" INTEGER,
    "payoutCents" INTEGER,
    "settledAt" TIMESTAMP(3),
    "financeTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_consignment_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manualOnly" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_channel_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "listingUrl" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_channel_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_channel_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_channel_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_auctions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "terms" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_auctions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_auction_lots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotNumber" INTEGER NOT NULL,
    "startingBidCents" INTEGER NOT NULL,
    "reservePriceCents" INTEGER,
    "minIncrementCents" INTEGER NOT NULL DEFAULT 500,
    "currentBidCents" INTEGER,
    "winningBidId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sell_auction_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_bids" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sell_bids_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sell_counters" (
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sell_counters_pkey" PRIMARY KEY ("tenantId","year","scope")
);

-- ----------------------------------------------------------------------------
-- UNIQUE CONSTRAINTS & INDEXES
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "hccall_customers_tenantId_customerNumber_key" ON "hccall_customers"("tenantId", "customerNumber");
CREATE INDEX IF NOT EXISTS "hccall_customers_tenantId_ownerUserId_idx" ON "hccall_customers"("tenantId", "ownerUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "hccall_services_tenantId_name_key" ON "hccall_services"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "hccall_promotions_tenantId_active_idx" ON "hccall_promotions"("tenantId", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "hccall_sale_statuses_tenantId_key_key" ON "hccall_sale_statuses"("tenantId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "hccall_sales_tenantId_code_key" ON "hccall_sales"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "hccall_sales_tenantId_clientUuid_key" ON "hccall_sales"("tenantId", "clientUuid");
CREATE INDEX IF NOT EXISTS "hccall_sales_tenantId_ownerUserId_idx" ON "hccall_sales"("tenantId", "ownerUserId");
CREATE INDEX IF NOT EXISTS "hccall_sales_tenantId_soldAt_idx" ON "hccall_sales"("tenantId", "soldAt");

CREATE INDEX IF NOT EXISTS "hccall_sale_changes_tenantId_saleId_idx" ON "hccall_sale_changes"("tenantId", "saleId");
CREATE INDEX IF NOT EXISTS "hccall_contacts_tenantId_customerId_occurredAt_idx" ON "hccall_contacts"("tenantId", "customerId", "occurredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "hccall_counters_tenantId_scope_year_key" ON "hccall_counters"("tenantId", "scope", "year");

CREATE UNIQUE INDEX IF NOT EXISTS "sell_item_types_tenantId_key_key" ON "sell_item_types"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "sell_locations_tenantId_parentId_idx" ON "sell_locations"("tenantId", "parentId");

CREATE UNIQUE INDEX IF NOT EXISTS "sell_items_tenantId_code_key" ON "sell_items"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_items_tenantId_slug_key" ON "sell_items"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "sell_items_tenantId_status_idx" ON "sell_items"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "sell_items_tenantId_typeId_idx" ON "sell_items"("tenantId", "typeId");

CREATE INDEX IF NOT EXISTS "sell_item_costs_tenantId_itemId_idx" ON "sell_item_costs"("tenantId", "itemId");
CREATE INDEX IF NOT EXISTS "sell_item_media_tenantId_itemId_idx" ON "sell_item_media"("tenantId", "itemId");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_provenances_itemId_key" ON "sell_provenances"("itemId");
CREATE INDEX IF NOT EXISTS "sell_restorations_tenantId_itemId_idx" ON "sell_restorations"("tenantId", "itemId");
CREATE INDEX IF NOT EXISTS "sell_item_events_tenantId_itemId_createdAt_idx" ON "sell_item_events"("tenantId", "itemId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "sell_consignments_tenantId_reference_key" ON "sell_consignments"("tenantId", "reference");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_consignment_items_itemId_key" ON "sell_consignment_items"("itemId");

CREATE UNIQUE INDEX IF NOT EXISTS "sell_channels_tenantId_key_key" ON "sell_channels"("tenantId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_channel_listings_tenantId_itemId_channelId_key" ON "sell_channel_listings"("tenantId", "itemId", "channelId");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_channel_jobs_tenantId_idempotencyKey_key" ON "sell_channel_jobs"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "sell_channel_jobs_tenantId_status_scheduledFor_idx" ON "sell_channel_jobs"("tenantId", "status", "scheduledFor");

CREATE UNIQUE INDEX IF NOT EXISTS "sell_auctions_tenantId_code_key" ON "sell_auctions"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_auction_lots_auctionId_lotNumber_key" ON "sell_auction_lots"("auctionId", "lotNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_auction_lots_itemId_key" ON "sell_auction_lots"("itemId");
CREATE INDEX IF NOT EXISTS "sell_bids_lotId_amountCents_idx" ON "sell_bids"("lotId", "amountCents");
CREATE UNIQUE INDEX IF NOT EXISTS "sell_counters_tenantId_scope_year_key" ON "sell_counters"("tenantId", "scope", "year");

-- ----------------------------------------------------------------------------
-- FOREIGN KEYS
-- ----------------------------------------------------------------------------

DO $$ BEGIN
    ALTER TABLE "hccall_promotions" ADD CONSTRAINT "hccall_promotions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "hccall_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_sales" ADD CONSTRAINT "hccall_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "hccall_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_sales" ADD CONSTRAINT "hccall_sales_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "hccall_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_sales" ADD CONSTRAINT "hccall_sales_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "hccall_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_sales" ADD CONSTRAINT "hccall_sales_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "hccall_sale_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_sale_changes" ADD CONSTRAINT "hccall_sale_changes_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "hccall_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "hccall_contacts" ADD CONSTRAINT "hccall_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "hccall_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_items" ADD CONSTRAINT "sell_items_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "sell_item_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_items" ADD CONSTRAINT "sell_items_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "sell_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_item_costs" ADD CONSTRAINT "sell_item_costs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_item_media" ADD CONSTRAINT "sell_item_media_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_provenances" ADD CONSTRAINT "sell_provenances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_restorations" ADD CONSTRAINT "sell_restorations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_item_events" ADD CONSTRAINT "sell_item_events_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_consignment_items" ADD CONSTRAINT "sell_consignment_items_consignmentId_fkey" FOREIGN KEY ("consignmentId") REFERENCES "sell_consignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_consignment_items" ADD CONSTRAINT "sell_consignment_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_channel_listings" ADD CONSTRAINT "sell_channel_listings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_channel_listings" ADD CONSTRAINT "sell_channel_listings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "sell_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_auction_lots" ADD CONSTRAINT "sell_auction_lots_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "sell_auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_auction_lots" ADD CONSTRAINT "sell_auction_lots_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sell_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sell_bids" ADD CONSTRAINT "sell_bids_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "sell_auction_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
