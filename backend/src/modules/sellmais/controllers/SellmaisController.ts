import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { SellItemTypeService } from '../services/SellItemTypeService';
import { SellLocationService } from '../services/SellLocationService';
import { SellItemService } from '../services/SellItemService';
import { SellItemCostService } from '../services/SellItemCostService';
import { SellItemStateService } from '../services/SellItemStateService';
import { SellConsignmentService } from '../services/SellConsignmentService';
import { SellChannelService } from '../services/SellChannelService';
import { SellAuctionService } from '../services/SellAuctionService';
import { SellAiService } from '../services/SellAiService';
import { MediaStorageService } from '../services/MediaStorageService';


// ===========================================================================
// SCHEMAS DE VALIDAÇÃO ZOD
// ===========================================================================

const CreateTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  fields: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['text', 'number', 'integer', 'money', 'date', 'enum', 'boolean']),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    unit: z.string().optional(),
    showInPublic: z.boolean().optional()
  })).optional().default([])
});

const CreateItemSchema = z.object({
  typeId: z.string().min(1),
  title: z.string().min(1, 'Título do artigo é obrigatório'),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  attributes: z.record(z.any()).optional(),
  categoryId: z.string().optional(),
  period: z.string().optional(),
  style: z.string().optional(),
  material: z.string().optional(),
  maker: z.string().optional(),
  conditionGrade: z.string().optional(),
  conditionNotes: z.string().optional(),
  dimensions: z.any().optional(),
  quantity: z.number().int().optional().default(1),
  isUnique: z.boolean().optional().default(true),
  status: z.enum(['DRAFT', 'AVAILABLE', 'RESERVED', 'IN_RESTORATION', 'IN_AUCTION', 'SOLD', 'RETURNED', 'UNAVAILABLE', 'WRITTEN_OFF']).optional(),
  acquisitionType: z.enum(['PURCHASE', 'CONSIGNMENT', 'TRADE_IN', 'DONATION']).optional(),
  acquisitionCents: z.number().int().optional().default(0),
  askingPriceCents: z.number().int().optional().nullable(),
  minPriceCents: z.number().int().optional().nullable(),
  supplierCompanyId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  internalNotes: z.string().optional().nullable(),
  vatMarginScheme: z.boolean().optional().default(false)
});

const AddCostSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amountCents: z.number().int().positive(),
  date: z.string().optional(),
  supplierCompanyId: z.string().optional(),
  supplierName: z.string().optional()
});

const TransitionStateSchema = z.object({
  targetState: z.enum(['DRAFT', 'AVAILABLE', 'RESERVED', 'IN_RESTORATION', 'IN_AUCTION', 'SOLD', 'RETURNED', 'UNAVAILABLE', 'WRITTEN_OFF']),
  soldPriceCents: z.number().int().optional(),
  buyerCompanyId: z.string().optional(),
  reason: z.string().optional()
});

export class SellmaisController {
  // =========================================================================
  // TIPOS DE ARTIGO
  // =========================================================================

  static async listTypes(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const types = await SellItemTypeService.listTypes(db, user.tenantId);
    return reply.send({ success: true, types, itemTypes: types });
  }

  static async createType(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateTypeSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const type = await SellItemTypeService.createType(db, user.tenantId, body);
    return reply.status(201).send({ success: true, type });
  }

  static async updateType(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CreateTypeSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const type = await SellItemTypeService.updateType(db, user.tenantId, id, body);
    return reply.send({ success: true, type });
  }

  static async deleteType(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await SellItemTypeService.deleteType(db, user.tenantId, id);
    return reply.send({ success: true, message: 'Tipo removido com sucesso.' });
  }

  // =========================================================================
  // LOCALIZAÇÕES FÍSICAS
  // =========================================================================

  static async listLocations(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const locations = await SellLocationService.listLocations(db, user.tenantId);
    return reply.send({ success: true, locations });
  }

  static async createLocation(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = z.object({ name: z.string().min(1), parentId: z.string().optional() }).parse(req.body);
    const db = forTenant(user.tenantId);
    const location = await SellLocationService.createLocation(db, user.tenantId, body);
    return reply.status(201).send({ success: true, location });
  }

  static async deleteLocation(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await SellLocationService.deleteLocation(db, user.tenantId, id);
    return reply.send({ success: true, message: 'Localização removida com sucesso.' });
  }

  // =========================================================================
  // ARTIGOS DO INVENTÁRIO
  // =========================================================================

  static async listItems(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as any;
    const db = forTenant(user.tenantId);
    const canReadCosts = user.role === 'SUPER_ADMIN' || user.role === 'TENANT_ADMIN' || user.role === 'MANAGER' || !req.entitlement || req.entitlement.permissions.includes('sellmais.cost.read');
    const result = await SellItemService.listItems(db, user.tenantId, query, canReadCosts);
    return reply.send({ success: true, ...result });
  }

  static async getItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const canReadCosts = user.role === 'SUPER_ADMIN' || user.role === 'TENANT_ADMIN' || user.role === 'MANAGER' || !req.entitlement || req.entitlement.permissions.includes('sellmais.cost.read');
    try {
      const item = await SellItemService.getItemById(db, user.tenantId, id, canReadCosts);
      return reply.send({ success: true, item });
    } catch (err: any) {
      if (err.message && err.message.includes('não encontrado')) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  static async createItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const raw = req.body as any;

    // Normalize field aliases
    const normalized: any = {
      typeId: raw.typeId,
      title: raw.title,
      shortDescription: raw.shortDescription,
      description: raw.description,
      attributes: raw.attributes || {},
      categoryId: raw.categoryId,
      period: raw.period || raw.era,
      style: raw.style,
      material: raw.material,
      maker: raw.maker,
      conditionGrade: raw.conditionGrade || raw.condition,
      conditionNotes: raw.conditionNotes,
      dimensions: raw.dimensions,
      quantity: raw.quantity,
      isUnique: raw.isUnique,
      status: raw.status,
      acquisitionType: raw.acquisitionType === 'DIRECT_PURCHASE' ? 'PURCHASE' : raw.acquisitionType,
      acquisitionCents: raw.acquisitionCents,
      askingPriceCents: raw.askingPriceCents ?? raw.priceCents,
      minPriceCents: raw.minPriceCents,
      supplierCompanyId: raw.supplierCompanyId || raw.supplierName,
      locationId: raw.locationId,
      tags: raw.tags,
      internalNotes: raw.internalNotes,
      vatMarginScheme: raw.vatMarginScheme
    };

    const body = CreateItemSchema.parse(normalized);
    const db = forTenant(user.tenantId);
    const item = await SellItemService.createItem(db, user.tenantId, user.sub, body as any);

    // If consignmentId passed, link automatically
    if (raw.consignmentId) {
      await SellConsignmentService.linkItemToConsignment(db, user.tenantId, raw.consignmentId, item.id, item.askingPriceCents || undefined).catch(() => {});
    }

    return reply.status(201).send({ success: true, item });
  }

  static async updateItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CreateItemSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const item = await SellItemService.updateItem(db, user.tenantId, user.sub, id, body);
    return reply.send({ success: true, item });
  }

  static async deleteItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await SellItemService.deleteItem(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, message: 'Artigo arquivado com sucesso.' });
  }

  static async restoreItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const item = await SellItemService.restoreItem(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, item });
  }

  // =========================================================================
  // MÁQUINA DE ESTADOS & TRANSIÇÕES
  // =========================================================================

  static async transitionState(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const raw = req.body as any;

    const normalized = {
      targetState: raw.targetState || raw.toStatus,
      soldPriceCents: raw.soldPriceCents ?? raw.salePriceCents,
      buyerCompanyId: raw.buyerCompanyId || raw.buyerName,
      reason: raw.reason || raw.notes
    };

    const body = TransitionStateSchema.parse(normalized);
    const db = forTenant(user.tenantId);

    try {
      const item = await SellItemStateService.transitionState(db, user.tenantId, user.sub, id, body.targetState, {
        soldPriceCents: body.soldPriceCents,
        buyerCompanyId: body.buyerCompanyId,
        reason: body.reason
      });

      // Calculate realProfitCents for response convenience
      let realProfitCents: number | null = null;
      if (item.soldPriceCents) {
        realProfitCents = item.soldPriceCents - item.totalCostCents;
      }

      return reply.send({ success: true, item: { ...item, realProfitCents } });
    } catch (err: any) {
      if (err.message && err.message.includes('não encontrado')) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      return reply.status(409).send({ error: 'INVALID_TRANSITION', message: err.message });
    }
  }

  // =========================================================================
  // CUSTOS & RECALCULO MATERIALIZADO
  // =========================================================================

  static async listCosts(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const costs = await SellItemCostService.listCosts(db, user.tenantId, id);
    return reply.send({ success: true, costs });
  }

  static async addCost(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const raw = req.body as any;
    const normalized = {
      ...raw,
      date: raw.date || new Date().toISOString()
    };
    const body = AddCostSchema.parse(normalized);
    const db = forTenant(user.tenantId);
    const cost = await SellItemCostService.addCost(db, user.tenantId, id, body);
    return reply.status(201).send({ success: true, cost });
  }

  static async deleteCost(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { costId } = req.params as { costId: string };
    const db = forTenant(user.tenantId);
    await SellItemCostService.deleteCost(db, user.tenantId, costId);
    return reply.send({ success: true, message: 'Custo removido e totais recalculados.' });
  }

  // =========================================================================
  // CONSIGNAÇÕES
  // =========================================================================

  static async listConsignments(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const consignments = await SellConsignmentService.listConsignments(db, user.tenantId);
    return reply.send({ success: true, consignments });
  }

  static async createConsignment(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const raw = req.body as any;
    const normalized = {
      consignorCompanyId: raw.consignorCompanyId || raw.consignorName || 'consignor-default',
      reference: raw.reference || ('CSG-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000)),
      commissionPercent: raw.commissionPercent ?? (raw.defaultCommissionRate ? Math.round(raw.defaultCommissionRate * 100) : 3000),
      commissionFixedCents: raw.commissionFixedCents,
      minPriceCents: raw.minPriceCents,
      startedAt: raw.startedAt,
      endsAt: raw.endsAt,
      settlementNotes: raw.settlementNotes || raw.notes
    };

    const db = forTenant(user.tenantId);
    const consignment = await SellConsignmentService.createConsignment(db, user.tenantId, normalized);
    return reply.status(201).send({ success: true, consignment: { ...consignment, code: consignment.reference } });
  }

  static async linkConsignmentItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({ itemId: z.string().min(1), agreedPriceCents: z.number().int().optional() }).parse(req.body);
    const db = forTenant(user.tenantId);
    const linked = await SellConsignmentService.linkItemToConsignment(db, user.tenantId, id, body.itemId, body.agreedPriceCents);
    return reply.status(201).send({ success: true, consignmentItem: linked });
  }

  static async settleConsignmentItem(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { itemId } = req.params as { id?: string; itemId: string };
    const raw = req.body as any;

    const db = forTenant(user.tenantId);
    const cItem = await db.sellConsignmentItem.findUnique({
      where: { itemId },
      include: { consignment: true }
    });

    if (!cItem || cItem.tenantId !== user.tenantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Item consignado não encontrado.' });
    }

    const shopCommissionCents = raw.shopCommissionCents ?? (cItem.soldPriceCents ? Math.round((cItem.soldPriceCents * (cItem.consignment.commissionPercent || 3000)) / 10000) : 0);
    const agreedPayoutCents = raw.agreedPayoutCents ?? Math.max(0, (cItem.soldPriceCents || 0) - shopCommissionCents);

    const updated = await db.sellConsignmentItem.update({
      where: { id: cItem.id },
      data: {
        commissionCents: shopCommissionCents,
        payoutCents: agreedPayoutCents,
        settledAt: new Date()
      }
    });

    return reply.send({
      success: true,
      consignmentItem: {
        ...updated,
        status: 'SETTLED',
        shopCommissionCents: updated.commissionCents,
        consignorPayoutCents: updated.payoutCents
      }
    });
  }

  // =========================================================================
  // CANAIS & OUTBOX
  // =========================================================================

  static async listChannels(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const channels = await SellChannelService.listChannels(db, user.tenantId);
    return reply.send({ success: true, channels });
  }

  static async createChannel(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const raw = req.body as any;
    const db = forTenant(user.tenantId);

    const key = (raw.code || raw.key || 'channel-' + Date.now()).toLowerCase();
    const channel = await db.sellChannel.upsert({
      where: { tenantId_key: { tenantId: user.tenantId, key } },
      create: {
        tenantId: user.tenantId,
        key,
        name: raw.name || key,
        manualOnly: raw.manualOnly ?? false,
        config: raw.config || { commissionRate: raw.commissionRate, syncMode: raw.syncMode },
        active: raw.isActive ?? raw.active ?? true
      },
      update: {
        name: raw.name || key,
        active: raw.isActive ?? raw.active ?? true
      }
    });

    return reply.status(201).send({ success: true, channel: { ...channel, code: channel.key } });
  }

  static async listListings(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { itemId } = req.query as { itemId?: string };
    const db = forTenant(user.tenantId);
    const listings = await SellChannelService.listListings(db, user.tenantId, itemId);
    return reply.send({ success: true, listings });
  }

  static async processChannelJobs(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const res = await SellChannelService.processPendingJobs(db, user.tenantId);
    return reply.send({ success: true, ...res });
  }

  // =========================================================================
  // LEILÕES & LICITAÇÕES
  // =========================================================================

  static async listAuctions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const auctions = await SellAuctionService.listAuctions(db, user.tenantId);
    return reply.send({ success: true, auctions });
  }

  static async createAuction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const raw = req.body as any;
    const body = z.object({
      title: z.string().min(1),
      code: z.string().optional(),
      startsAt: z.string(),
      endsAt: z.string(),
      terms: z.string().optional()
    }).parse({
      ...raw,
      code: raw.code || ('AUC-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000))
    });

    const db = forTenant(user.tenantId);
    const auction = await SellAuctionService.createAuction(db, user.tenantId, body);
    return reply.status(201).send({ success: true, auction });
  }

  static async addAuctionLot(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const raw = req.body as any;
    const body = z.object({
      itemId: z.string().min(1),
      lotNumber: z.number().int().positive(),
      startingBidCents: z.number().int().positive(),
      reservePriceCents: z.number().int().optional(),
      minIncrementCents: z.number().int().optional()
    }).parse({
      itemId: raw.itemId,
      lotNumber: raw.lotNumber,
      startingBidCents: raw.startingBidCents ?? raw.startingPriceCents,
      reservePriceCents: raw.reservePriceCents,
      minIncrementCents: raw.minIncrementCents ?? raw.minBidIncrementCents ?? 500
    });

    const db = forTenant(user.tenantId);
    const lot = await SellAuctionService.addLot(db, user.tenantId, id, body);
    return reply.status(201).send({ success: true, lot });
  }

  static async placeBid(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { lotId } = req.params as { lotId: string };
    const body = z.object({ amountCents: z.number().int().positive() }).parse(req.body);
    const db = forTenant(user.tenantId);

    try {
      const res = await SellAuctionService.placeBid(db, user.tenantId, lotId, user.sub, body.amountCents);
      const bidCount = await db.sellBid.count({ where: { lotId } });
      return reply.status(201).send({
        success: true,
        bid: res.bid,
        lot: {
          ...res.lot,
          bidCount
        }
      });
    } catch (err: any) {
      return reply.status(400).send({ error: 'BID_REJECTED', message: err.message });
    }
  }

  // =========================================================================
  // VALORIZAÇÃO DE INVENTÁRIO & DASHBOARD
  // =========================================================================

  static async getValuation(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const valuation = await SellItemService.getInventoryValuation(db, user.tenantId);
    return reply.send({ success: true, ...valuation });
  }

  // =========================================================================
  // PROVENIÊNCIA, RESTAUROS & MEDIA (Fase 7)
  // =========================================================================

  static async addProvenance(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({
      ownerName: z.string().optional(),
      period: z.string().optional(),
      location: z.string().optional(),
      documentRef: z.string().optional(),
      notes: z.string().optional(),
      order: z.number().int().optional()
    }).parse(req.body);

    const db = forTenant(user.tenantId);
    const provenance = await SellItemService.addProvenance(db, user.tenantId, user.sub, id, body);
    return reply.status(201).send({ success: true, provenance });
  }

  static async addRestoration(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const raw = req.body as any;
    const body = z.object({
      restorerName: z.string().min(1),
      restorerCompanyId: z.string().optional(),
      description: z.string().min(1),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      costCents: z.number().int().optional(),
      conditionBefore: z.string().optional(),
      conditionAfter: z.string().optional()
    }).parse({
      ...raw,
      costCents: raw.costCents ?? (raw.cost ? Math.round(Number(raw.cost) * 100) : undefined)
    });

    const db = forTenant(user.tenantId);
    const restoration = await SellItemService.addRestoration(db, user.tenantId, user.sub, id, {
      ...body,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined
    });
    return reply.status(201).send({ success: true, restoration });
  }

  static async addMedia(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({
      url: z.string().min(1),
      thumbnailUrl: z.string().optional(),
      mediaType: z.string().optional(),
      caption: z.string().optional(),
      isCover: z.boolean().optional(),
      sortOrder: z.number().int().optional()
    }).parse(req.body);

    const db = forTenant(user.tenantId);
    const media = await SellItemService.addMedia(db, user.tenantId, user.sub, id, body);
    return reply.status(201).send({ success: true, media });
  }

  static async deleteMedia(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { mediaId } = req.params as { mediaId: string };
    const db = forTenant(user.tenantId);
    await SellItemService.deleteMedia(db, user.tenantId, user.sub, mediaId);
    return reply.send({ success: true, message: 'Ficheiro removido com sucesso.' });
  }

  // =========================================================================
  // ASSISTENTE DE IA DE DESCRIÇÕES & PERITAGEM (Fase 10)
  // =========================================================================

  static async describeItemAi(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id?: string };
    const body = z.object({
      title: z.string().min(1),
      typeId: z.string().optional(),
      period: z.string().optional(),
      style: z.string().optional(),
      material: z.string().optional(),
      maker: z.string().optional(),
      conditionNotes: z.string().optional(),
      dimensions: z.any().optional()
    }).parse(req.body);

    const db = forTenant(user.tenantId);
    const output = await SellAiService.generateItemDescription(
      db,
      user.tenantId,
      user.sub,
      id || null,
      body
    );

    return reply.send({ success: true, ...output });
  }

  // =========================================================================
  // RELATÓRIOS & ALERTAS OPERACIONAIS (Fase 13)
  // =========================================================================

  static async getAgingReport(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const report = await SellItemService.getAgingReport(db, user.tenantId);
    return reply.send({ success: true, ...report });
  }

  static async getAlerts(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const alerts = await SellItemService.getAlerts(db, user.tenantId);
    return reply.send({ success: true, ...alerts });
  }

  static async getProfitabilityReport(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const report = await SellItemService.getProfitabilityReport(db, user.tenantId);
    return reply.send({ success: true, ...report });
  }

  // =========================================================================
  // STORAGE CLOUDFLARE R2 & PRESIGNED URLS (D-16)
  // =========================================================================

  static async getPresignedMediaUrl(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = z.object({
      itemId: z.string().optional(),
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      sizeBytes: z.number().int().positive().optional()
    }).parse(req.body);

    const result = await MediaStorageService.generatePresignedUploadUrl({
      tenantId: user.tenantId,
      userId: user.sub,
      itemId: body.itemId,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes
    });

    return reply.send({ success: true, ...result });
  }

  // =========================================================================
  // VERCEL CRON: ENCERRAMENTO ATÓMICO DE LEILÕES (B.3)
  // =========================================================================

  static async closePendingAuctions(req: FastifyRequest, reply: FastifyReply) {
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET || 'dev_cron_secret';
    const isVercelCron = req.headers['x-vercel-cron'] === '1' || (authHeader && authHeader === `Bearer ${cronSecret}`);
    const user = req.user as any;

    // Permitido via Vercel Cron Secret ou Super Admin
    if (!isVercelCron && (!user || (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN'))) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas crons autorizados ou administradores podem executar esta operação.' });
    }

    const tenantId = user?.tenantId;
    const result = await SellAuctionService.closePendingAuctions(tenantId);
    return reply.send({ success: true, ...result });
  }
}


