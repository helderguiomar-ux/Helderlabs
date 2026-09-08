import { SellCounterService } from './SellCounterService';
import { SellItemTypeService } from './SellItemTypeService';
import { SellItemStatus, SellAcquisitionType } from '@prisma/client';

export class SellItemService {
  static slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  static async createItem(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      typeId: string;
      title: string;
      shortDescription?: string;
      description?: string;
      attributes?: Record<string, any>;
      categoryId?: string;
      period?: string;
      style?: string;
      material?: string;
      maker?: string;
      conditionGrade?: string;
      conditionNotes?: string;
      dimensions?: any;
      quantity?: number;
      isUnique?: boolean;
      status?: SellItemStatus;
      acquisitionType?: SellAcquisitionType;
      acquisitionCents?: number;
      askingPriceCents?: number;
      minPriceCents?: number;
      supplierCompanyId?: string;
      locationId?: string;
      tags?: string[];
      internalNotes?: string;
      vatMarginScheme?: boolean;
    }
  ) {
    // 1. Validate Item Type and Attributes JSON
    const type = await SellItemTypeService.getTypeById(db, tenantId, data.typeId);
    const validAttributes = SellItemTypeService.validateAttributes(type.fields as any, data.attributes || {});

    // 2. Generate Atomic Code & Unique Slug
    const code = await SellCounterService.getNextCode(db, tenantId, 'item');
    const baseSlug = this.slugify(data.title);
    const slug = `${baseSlug}-${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    const acquisitionCents = Math.round(data.acquisitionCents || 0);
    const askingPriceCents = data.askingPriceCents ? Math.round(data.askingPriceCents) : null;
    const minPriceCents = data.minPriceCents ? Math.round(data.minPriceCents) : null;
    const status = data.status || SellItemStatus.DRAFT;

    const availableSince = status === SellItemStatus.AVAILABLE ? new Date() : null;
    const publishedAt = status === SellItemStatus.AVAILABLE ? new Date() : null;

    // 3. Create Item
    const item = await db.sellItem.create({
      data: {
        tenantId,
        code,
        slug,
        typeId: data.typeId,
        title: data.title.trim(),
        shortDescription: data.shortDescription || null,
        description: data.description || null,
        attributes: validAttributes,
        categoryId: data.categoryId || null,
        period: data.period || null,
        style: data.style || null,
        material: data.material || null,
        maker: data.maker || null,
        conditionGrade: data.conditionGrade || null,
        conditionNotes: data.conditionNotes || null,
        dimensions: data.dimensions || null,
        quantity: data.quantity ?? 1,
        isUnique: data.isUnique ?? true,
        status,
        acquisitionType: data.acquisitionType || SellAcquisitionType.PURCHASE,
        acquisitionCents,
        extraCostsCents: 0,
        totalCostCents: acquisitionCents,
        askingPriceCents,
        minPriceCents,
        supplierCompanyId: data.supplierCompanyId || null,
        assignedUserId: userId,
        locationId: data.locationId || null,
        tags: data.tags || [],
        internalNotes: data.internalNotes || null,
        vatMarginScheme: data.vatMarginScheme ?? false,
        availableSince,
        publishedAt
      }
    });

    // 4. Record Initial Creation Event
    await db.sellItemEvent.create({
      data: {
        tenantId,
        itemId: item.id,
        eventType: 'CREATED',
        toState: item.status,
        description: `Artigo ${item.code} criado (${item.title})`,
        actorUserId: userId
      }
    });

    return item;
  }

  static async updateItem(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    data: any
  ) {
    const existing = await db.sellItem.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    const updateData: any = { ...data };

    if (data.attributes) {
      const type = await SellItemTypeService.getTypeById(db, tenantId, existing.typeId);
      updateData.attributes = SellItemTypeService.validateAttributes(type.fields as any, data.attributes);
    }

    if (data.acquisitionCents !== undefined) {
      updateData.acquisitionCents = Math.round(data.acquisitionCents);
      updateData.totalCostCents = updateData.acquisitionCents + existing.extraCostsCents;
    }

    if (data.askingPriceCents !== undefined) {
      updateData.askingPriceCents = data.askingPriceCents ? Math.round(data.askingPriceCents) : null;
    }

    if (data.minPriceCents !== undefined) {
      updateData.minPriceCents = data.minPriceCents ? Math.round(data.minPriceCents) : null;
    }

    const updated = await db.sellItem.update({
      where: { id },
      data: updateData
    });

    await db.sellItemEvent.create({
      data: {
        tenantId,
        itemId: id,
        eventType: 'UPDATED',
        description: 'Dados do artigo atualizados',
        actorUserId: userId
      }
    });

    return updated;
  }

  static async getItemById(db: any, tenantId: string, id: string, canReadCosts: boolean = true) {
    const item = await db.sellItem.findUnique({
      where: { id },
      include: {
        type: true,
        costs: { where: { deletedAt: null }, orderBy: { date: 'desc' } },
        media: { where: { deletedAt: null }, orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] },
        provenance: true,
        restorations: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        events: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    // Calculate days idle
    let daysIdle = 0;
    if (item.availableSince && !item.soldAt) {
      const diffMs = Date.now() - new Date(item.availableSince).getTime();
      daysIdle = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    // Calculate Margin
    let marginCents: number | null = null;
    if (item.soldPriceCents) {
      if (item.acquisitionType === SellAcquisitionType.CONSIGNMENT) {
        // Commission from consignment item
        const cItem = await db.sellConsignmentItem.findUnique({ where: { itemId: item.id } });
        marginCents = cItem?.commissionCents || 0;
      } else {
        marginCents = item.soldPriceCents - item.totalCostCents;
      }
    }

    const res: any = {
      ...item,
      daysIdle,
      marginCents
    };

    // Mask cost fields if user lacks sellmais.cost.read
    if (!canReadCosts) {
      delete res.acquisitionCents;
      delete res.extraCostsCents;
      delete res.totalCostCents;
      delete res.minPriceCents;
      delete res.costs;
      delete res.marginCents;
    }

    return res;
  }

  static async listItems(
    db: any,
    tenantId: string,
    query: {
      search?: string;
      status?: string;
      typeId?: string;
      acquisitionType?: string;
      limit?: number;
      offset?: number;
    },
    canReadCosts: boolean = true
  ) {
    const take = Math.min(query.limit ? Number(query.limit) : 50, 200);
    const skip = query.offset ? Number(query.offset) : 0;

    const where: any = {
      tenantId,
      deletedAt: null
    };

    if (query.status) where.status = query.status;
    if (query.typeId) where.typeId = query.typeId;
    if (query.acquisitionType) where.acquisitionType = query.acquisitionType;

    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { maker: { contains: q, mode: 'insensitive' } },
        { style: { contains: q, mode: 'insensitive' } },
        { period: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      db.sellItem.findMany({
        where,
        take,
        skip,
        include: {
          type: true,
          media: { where: { isCover: true, deletedAt: null }, take: 1 }
        },
        orderBy: { createdAt: 'desc' }
      }),
      db.sellItem.count({ where })
    ]);

    const sanitized = items.map((it: any) => {
      const res = { ...it, coverUrl: it.media[0]?.url || null };
      if (!canReadCosts) {
        delete res.acquisitionCents;
        delete res.extraCostsCents;
        delete res.totalCostCents;
        delete res.minPriceCents;
      }
      return res;
    });

    return {
      items: sanitized,
      total,
      limit: take,
      offset: skip
    };
  }

  static async deleteItem(db: any, tenantId: string, userId: string, id: string) {
    return db.sellItem.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  static async restoreItem(db: any, tenantId: string, userId: string, id: string) {
    return db.sellItem.update({
      where: { id },
      data: { deletedAt: null }
    });
  }

  /**
   * Calculates comprehensive inventory valuation separating own stock from consignment.
   */
  static async getInventoryValuation(db: any, tenantId: string) {
    const activeStates = [
      SellItemStatus.AVAILABLE,
      SellItemStatus.RESERVED,
      SellItemStatus.IN_RESTORATION,
      SellItemStatus.IN_AUCTION
    ];

    const activeItems = await db.sellItem.findMany({
      where: {
        tenantId,
        status: { in: activeStates },
        deletedAt: null
      }
    });

    let ownItemsCount = 0;
    let ownTotalCostCents = 0;
    let ownAskingValueCents = 0;

    let consignedItemsCount = 0;
    let consignedAskingValueCents = 0;

    const idleBuckets = {
      under30Days: 0,
      days31to90: 0,
      days91to180: 0,
      over180Days: 0
    };

    const now = Date.now();

    for (const it of activeItems) {
      if (it.acquisitionType === SellAcquisitionType.CONSIGNMENT) {
        consignedItemsCount++;
        consignedAskingValueCents += it.askingPriceCents || 0;
      } else {
        ownItemsCount++;
        ownTotalCostCents += it.totalCostCents || 0;
        ownAskingValueCents += it.askingPriceCents || 0;
      }

      if (it.availableSince) {
        const days = Math.floor((now - new Date(it.availableSince).getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 30) idleBuckets.under30Days++;
        else if (days <= 90) idleBuckets.days31to90++;
        else if (days <= 180) idleBuckets.days91to180++;
        else idleBuckets.over180Days++;
      }
    }

    return {
      ownStock: {
        count: ownItemsCount,
        totalCostCents: ownTotalCostCents,
        askingValueCents: ownAskingValueCents
      },
      consignedStock: {
        count: consignedItemsCount,
        askingValueCents: consignedAskingValueCents
      },
      idleDistribution: idleBuckets,
      totalActiveItems: activeItems.length
    };
  }

  /**
   * Adds provenance ownership record (Phase 7)
   */
  static async addProvenance(
    db: any,
    tenantId: string,
    userId: string,
    itemId: string,
    data: {
      description?: string;
      ownerName?: string;
      period?: string;
      location?: string;
      confidence?: string;
      isPublic?: boolean;
      documents?: any;
    }
  ) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    const descParts = [];
    if (data.ownerName) descParts.push(`Proprietário: ${data.ownerName}`);
    if (data.period) descParts.push(`Período: ${data.period}`);
    if (data.location) descParts.push(`Localização: ${data.location}`);
    if (data.description) descParts.push(data.description);
    const fullDesc = descParts.length > 0 ? descParts.join(' | ') : 'Registo de proveniência';

    const provenance = await db.sellProvenance.upsert({
      where: { itemId },
      create: {
        tenantId,
        itemId,
        description: fullDesc,
        confidence: data.confidence || 'ESTIMATED',
        isPublic: data.isPublic ?? true,
        documents: data.documents || null
      },
      update: {
        description: fullDesc,
        confidence: data.confidence || 'ESTIMATED',
        isPublic: data.isPublic ?? true,
        documents: data.documents || null
      }
    });

    await db.sellItemEvent.create({
      data: {
        tenantId,
        itemId,
        eventType: 'PROVENANCE_ADDED',
        description: `Registo de proveniência atualizado: ${data.ownerName || 'Anónimo'} (${data.period || 'Sem época'})`,
        actorUserId: userId
      }
    });

    return {
      ...provenance,
      ownerName: data.ownerName || null,
      period: data.period || null
    };
  }

  /**
   * Adds restoration intervention and links cost (Phase 7)
   */
  static async addRestoration(
    db: any,
    tenantId: string,
    userId: string,
    itemId: string,
    data: {
      restorerName: string;
      description: string;
      startDate?: Date;
      endDate?: Date;
      costCents?: number;
      status?: string;
    }
  ) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    const costCents = data.costCents ? Math.round(data.costCents) : 0;

    const restoration = await db.sellRestoration.create({
      data: {
        tenantId,
        itemId,
        restorerName: data.restorerName.trim(),
        description: data.description.trim(),
        startedAt: data.startDate || null,
        completedAt: data.endDate || null,
        costCents,
        status: data.status || 'COMPLETED'
      }
    });

    // If cost was incurred, atomically add it to item costs
    if (costCents > 0) {
      await db.sellItemCost.create({
        data: {
          tenantId,
          itemId,
          category: 'RESTORATION',
          description: `Restauro: ${data.description.substring(0, 100)} (${data.restorerName})`,
          amountCents: costCents,
          date: data.endDate || new Date()
        }
      });

      const allCosts = await db.sellItemCost.findMany({
        where: { itemId, tenantId, deletedAt: null }
      });
      const extraCostsCents = allCosts.reduce((acc: number, c: any) => acc + c.amountCents, 0);

      await db.sellItem.update({
        where: { id: itemId },
        data: {
          extraCostsCents,
          totalCostCents: item.acquisitionCents + extraCostsCents
        }
      });
    }

    await db.sellItemEvent.create({
      data: {
        tenantId,
        itemId,
        eventType: 'RESTORATION_LOGGED',
        description: `Intervenção de restauro registada por ${data.restorerName}`,
        actorUserId: userId
      }
    });

    return restoration;
  }

  /**
   * Adds media asset (Phase 7)
   */
  static async addMedia(
    db: any,
    tenantId: string,
    userId: string,
    itemId: string,
    data: {
      url: string;
      caption?: string;
      isCover?: boolean;
      sortOrder?: number;
    }
  ) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    if (data.isCover) {
      await db.sellItemMedia.updateMany({
        where: { itemId, tenantId, isCover: true },
        data: { isCover: false }
      });
    }

    const storageKey = 'media/' + itemId + '/' + Date.now();
    const media = await db.sellItemMedia.create({
      data: {
        tenantId,
        itemId,
        url: data.url,
        storageKey,
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        checksumSha256: 'dummy-sha256',
        caption: data.caption || null,
        isCover: data.isCover ?? false,
        sortOrder: data.sortOrder ?? 100
      }
    });

    return media;
  }

  /**
   * Deletes media asset logically
   */
  static async deleteMedia(db: any, tenantId: string, userId: string, mediaId: string) {
    return db.sellItemMedia.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() }
    });
  }

  /**
   * Aging report for inventory items (Phase 13)
   */
  static async getAgingReport(db: any, tenantId: string) {
    const items = await db.sellItem.findMany({
      where: {
        tenantId,
        status: { in: [SellItemStatus.AVAILABLE, SellItemStatus.RESERVED, SellItemStatus.IN_RESTORATION] },
        deletedAt: null
      },
      include: { type: true },
      orderBy: { availableSince: 'asc' }
    });

    const now = Date.now();
    const rows = items.map((it: any) => {
      const days = it.availableSince
        ? Math.floor((now - new Date(it.availableSince).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: it.id,
        code: it.code,
        title: it.title,
        typeName: it.type?.name || 'Geral',
        status: it.status,
        acquisitionType: it.acquisitionType,
        totalCostCents: it.totalCostCents,
        askingPriceCents: it.askingPriceCents,
        daysIdle: days,
        urgency: days > 180 ? 'CRITICAL' : days > 90 ? 'HIGH' : days > 30 ? 'MEDIUM' : 'LOW'
      };
    });

    return {
      totalItems: rows.length,
      criticalAgingCount: rows.filter((r: any) => r.urgency === 'CRITICAL').length,
      highAgingCount: rows.filter((r: any) => r.urgency === 'HIGH').length,
      items: rows
    };
  }

  /**
   * Actionable alerts (expiring consignments, missing pricing, idle items) (Phase 13)
   */
  static async getAlerts(db: any, tenantId: string) {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 1. Expiring consignments
    const expiringConsignments = await db.sellConsignment.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        endsAt: { lte: in30Days, gte: now },
        deletedAt: null
      },
      include: {
        items: true
      }
    });

    // 2. Available items without asking price
    const unpricedItems = await db.sellItem.findMany({
      where: {
        tenantId,
        status: SellItemStatus.AVAILABLE,
        askingPriceCents: null,
        deletedAt: null
      },
      select: { id: true, code: true, title: true }
    });

    // 3. Items without cover photo
    const allAvailable = await db.sellItem.findMany({
      where: {
        tenantId,
        status: SellItemStatus.AVAILABLE,
        deletedAt: null
      },
      include: {
        media: { where: { deletedAt: null, isCover: true } }
      }
    });
    const itemsWithoutCover = allAvailable.filter((it: any) => it.media.length === 0).map((it: any) => ({
      id: it.id,
      code: it.code,
      title: it.title
    }));

    return {
      expiringConsignments: expiringConsignments.map((c: any) => ({
        id: c.id,
        reference: c.reference,
        consignorCompanyId: c.consignorCompanyId,
        endsAt: c.endsAt,
        itemCount: c.items.length
      })),
      unpricedItems,
      itemsWithoutCover
    };
  }

  /**
   * Profitability and turnover report (Phase 13)
   */
  static async getProfitabilityReport(db: any, tenantId: string) {
    const soldItems = await db.sellItem.findMany({
      where: {
        tenantId,
        status: { in: [SellItemStatus.SOLD] },
        deletedAt: null
      },
      include: { type: true }
    });


    let totalRevenueCents = 0;
    let totalCostCents = 0;
    let totalProfitCents = 0;

    for (const it of soldItems) {
      const soldPrice = it.soldPriceCents || 0;
      totalRevenueCents += soldPrice;
      totalCostCents += it.totalCostCents || 0;
      totalProfitCents += (soldPrice - (it.totalCostCents || 0));
    }

    const marginPct = totalRevenueCents > 0 ? ((totalProfitCents / totalRevenueCents) * 100).toFixed(1) : '0.0';

    return {
      soldCount: soldItems.length,
      totalRevenueCents,
      totalCostCents,
      totalProfitCents,
      averageMarginPercentage: marginPct,
      items: soldItems.map((it: any) => ({
        id: it.id,
        code: it.code,
        title: it.title,
        typeName: it.type?.name || 'Geral',
        soldPriceCents: it.soldPriceCents,
        totalCostCents: it.totalCostCents,
        profitCents: (it.soldPriceCents || 0) - (it.totalCostCents || 0),
        soldAt: it.soldAt
      }))
    };
  }
}

