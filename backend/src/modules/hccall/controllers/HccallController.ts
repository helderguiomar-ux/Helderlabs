import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { HccallOrgContextService } from '../services/HccallOrgContextService';
import { HccallProductService } from '../services/HccallProductService';
import { HccallDynamizationService } from '../services/HccallDynamizationService';
import { HccallSaleService } from '../services/HccallSaleService';
import { HccallObjectiveService } from '../services/HccallObjectiveService';
import { HccallPerformanceService } from '../services/HccallPerformanceService';
import { HccallAlertService } from '../services/HccallAlertService';
import { HccallCommissionEngine } from '../services/HccallCommissionEngine';
import { HccallConfigService } from '../services/HccallConfigService';
import { HccallCustomerService } from '../services/HccallCustomerService';
import { HccallSyncService } from '../services/HccallSyncService';

// Listeners SSE para atualização em tempo real do desktop
const sseClients = new Map<string, Set<FastifyReply>>();

export function broadcastUserEvent(userId: string, event: string, data: any) {
  const clients = sseClients.get(userId);
  if (clients) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const reply of clients) {
      try {
        reply.raw.write(payload);
      } catch (err) {
        clients.delete(reply);
      }
    }
  }
}

// Schemas Zod
const CreateProductSchema = z.object({
  name: z.string().min(1, 'Nome do produto é obrigatório'),
  sku: z.string().optional(),
  category: z.string().optional(),
  baseValueCents: z.number().int().optional(),
  sortOrder: z.number().int().optional()
});

const CreateDynamizationSchema = z.object({
  name: z.string().min(1, 'Nome da dinamização é obrigatório'),
  description: z.string().optional(),
  tierMode: z.enum(['RETROACTIVE', 'MARGINAL', 'FLAT']).default('RETROACTIVE'),
  startsAt: z.string().or(z.date()),
  endsAt: z.string().or(z.date()).optional().nullable(),
  tiers: z.array(z.object({
    minQuantity: z.number().int(),
    maxQuantity: z.number().int().nullable().optional(),
    unitAmountCents: z.number().int()
  })).optional(),
  bonuses: z.array(z.object({
    thresholdCount: z.number().int(),
    bonusAmountCents: z.number().int()
  })).optional()
});

const CreateSaleSchema = z.object({
  clientUuid: z.string().optional(),
  customerNumber: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  promotionId: z.string().optional(),
  dynamizationId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.number().int().optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().default(1),
    unitPriceCents: z.number().int().optional()
  })).optional(),
  commissionCents: z.number().int().optional(),
  saleValueCents: z.number().int().optional(),
  statusId: z.string().optional(),
  soldAt: z.string().optional(),
  notes: z.string().optional()
});

const CreateObjectiveSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.string().default('SALES_COUNT'),
  targetValue: z.number().int(),
  unit: z.string().default('vendas'),
  periodStart: z.string(),
  periodEnd: z.string(),
  productId: z.string().optional()
});

const SwitchContextSchema = z.object({
  companyName: z.string().min(1),
  workplace: z.string().min(1),
  jobRole: z.string().min(1),
  operationType: z.string().optional(),
  businessArea: z.string().optional(),
  workingDaysConfig: z.any().optional()
});

const SimulateSchema = z.object({
  dynamizationId: z.string(),
  additionalSalesCount: z.number().int().min(1)
});

const ServiceSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional()
});

const PromotionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  serviceId: z.string().optional().nullable(),
  suggestedCommissionCents: z.number().int().optional().default(0),
  promoValueCents: z.number().int().optional().nullable(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  active: z.boolean().optional().default(true),
  notes: z.string().optional().nullable()
});

const StatusSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isTerminal: z.boolean().optional(),
  commissionState: z.enum(['FORECAST', 'CONFIRMED', 'PAID', 'VOID']).optional()
});

export class HccallController {
  // -------------------------------------------------------------------------
  // CONTEXTO ORGANIZACIONAL
  // -------------------------------------------------------------------------
  static async getCurrentContext(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const context = await HccallOrgContextService.getCurrentContext(db, user.tenantId, user.sub);
    return reply.send({ success: true, context });
  }

  static async switchContext(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = SwitchContextSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const context = await HccallOrgContextService.switchContext(db, user.tenantId, user.sub, body);
    broadcastUserEvent(user.sub, 'context_updated', context);
    return reply.send({ success: true, context });
  }

  // -------------------------------------------------------------------------
  // CATÁLOGO DE PRODUTOS
  // -------------------------------------------------------------------------
  static async listProducts(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const products = await HccallProductService.listProducts(db, user.tenantId, user.sub);
    return reply.send({ success: true, products });
  }

  static async createProduct(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateProductSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const product = await HccallProductService.createProduct(db, user.tenantId, user.sub, body);
    broadcastUserEvent(user.sub, 'products_updated', product);
    return reply.status(201).send({ success: true, product });
  }

  static async updateProduct(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CreateProductSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const product = await HccallProductService.updateProduct(db, user.tenantId, user.sub, id, body);
    return reply.send({ success: true, product });
  }

  static async deleteProduct(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallProductService.deleteProduct(db, user.tenantId, user.sub, id);
    return reply.send({ success: true });
  }

  // -------------------------------------------------------------------------
  // DINAMIZAÇÕES & REGRAS COMERCIAIS
  // -------------------------------------------------------------------------
  static async listDynamizations(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const dynamizations = await HccallDynamizationService.listDynamizations(db, user.tenantId, user.sub);
    return reply.send({ success: true, dynamizations });
  }

  static async createDynamization(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateDynamizationSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const dynamization = await HccallDynamizationService.createDynamization(db, user.tenantId, user.sub, body as any);
    broadcastUserEvent(user.sub, 'dynamizations_updated', dynamization);
    return reply.status(201).send({ success: true, dynamization });
  }

  static async getDynamization(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const dynamization = await HccallDynamizationService.getDynamization(db, user.tenantId, user.sub, id);
    if (!dynamization) return reply.status(404).send({ error: 'Dinamização não encontrada' });
    return reply.send({ success: true, dynamization });
  }

  static async updateDynamization(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CreateDynamizationSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const dynamization = await HccallDynamizationService.updateDynamization(db, user.tenantId, user.sub, id, body as any);
    return reply.send({ success: true, dynamization });
  }

  static async deleteDynamization(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const result = await HccallDynamizationService.deleteDynamization(db, user.tenantId, user.sub, id);
    if (!result) return reply.status(404).send({ error: 'Dinamização não encontrada' });
    broadcastUserEvent(user.sub, 'dynamizations_updated', { id, archived: true });
    return reply.send({
      success: true,
      archived: true,
      linkedSales: result.linkedSales,
      message:
        result.linkedSales > 0
          ? `Dinamização arquivada. ${result.linkedSales} venda(s) histórica(s) mantêm a comissão calculada.`
          : 'Dinamização arquivada.'
    });
  }

  // -------------------------------------------------------------------------
  // VENDAS
  // -------------------------------------------------------------------------
  static async listSales(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const result = await HccallSaleService.listSales(db, user.tenantId, user.sub, req.query as any);
    return reply.send({ success: true, ...result, items: result.sales });
  }

  static async createSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateSaleSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const result = await HccallSaleService.createSale(db, user.tenantId, user.sub, body);
    broadcastUserEvent(user.sub, 'sale_created', result.sale);
    return reply.status(201).send({ success: true, ...result });
  }

  static async getSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    try {
      const sale = await HccallSaleService.getSale(db, user.tenantId, user.sub, id);
      if (!sale) return reply.status(404).send({ error: 'Venda não encontrada' });
      return reply.send({ success: true, sale });
    } catch (err: any) {
      return reply.status(404).send({ error: err.message || 'Venda não encontrada' });
    }
  }

  static async updateSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    try {
      const sale = await HccallSaleService.updateSale(db, user.tenantId, user.sub, id, req.body as any);
      broadcastUserEvent(user.sub, 'sale_updated', sale);
      return reply.send({ success: true, sale });
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  }

  static async deleteSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    try {
      await HccallSaleService.deleteSale(db, user.tenantId, user.sub, id);
      broadcastUserEvent(user.sub, 'sale_deleted', { id });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  }

  // -------------------------------------------------------------------------
  // OBJETIVOS & RITMO
  // -------------------------------------------------------------------------
  static async listObjectives(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const objectives = await HccallObjectiveService.listObjectives(db, user.tenantId, user.sub);
    return reply.send({ success: true, objectives });
  }

  static async createObjective(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateObjectiveSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const objective = await HccallObjectiveService.createObjective(db, user.tenantId, user.sub, body);
    broadcastUserEvent(user.sub, 'objectives_updated', objective);
    return reply.status(201).send({ success: true, objective });
  }

  static async updateObjective(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CreateObjectiveSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const objective = await HccallObjectiveService.updateObjective(db, user.tenantId, user.sub, id, body as any);
    if (!objective) return reply.status(404).send({ error: 'Objetivo não encontrado' });
    broadcastUserEvent(user.sub, 'objectives_updated', objective);
    return reply.send({ success: true, objective });
  }

  static async deleteObjective(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const objective = await HccallObjectiveService.deleteObjective(db, user.tenantId, user.sub, id);
    if (!objective) return reply.status(404).send({ error: 'Objetivo não encontrado' });
    broadcastUserEvent(user.sub, 'objectives_updated', { id, deleted: true });
    return reply.send({ success: true });
  }

  // -------------------------------------------------------------------------
  // PERFORMANCE & CALENDÁRIO
  // -------------------------------------------------------------------------
  static async getPerformance(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const metrics = await HccallPerformanceService.getPerformanceMetrics(db, user.tenantId, user.sub);
    return reply.send({ success: true, ...metrics });
  }

  // -------------------------------------------------------------------------
  // ALERTAS DETERMINÍSTICOS
  // -------------------------------------------------------------------------
  static async getAlerts(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const alerts = await HccallAlertService.evaluateAndSyncAlerts(db, user.tenantId, user.sub);
    return reply.send({ success: true, alerts });
  }

  static async dismissAlert(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallAlertService.dismissAlert(db, user.tenantId, user.sub, id);
    return reply.send({ success: true });
  }

  // -------------------------------------------------------------------------
  // SIMULADOR "E SE..."
  // -------------------------------------------------------------------------
  static async simulate(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = SimulateSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const [sales, dyn] = await Promise.all([
      db.hccallSale.findMany({
        where: { tenantId: user.tenantId, ownerUserId: user.sub, deletedAt: null },
        include: { items: true }
      }),
      db.hccallDynamization.findFirst({
        where: { id: body.dynamizationId, tenantId: user.tenantId, userId: user.sub },
        include: { tiers: true, bonuses: true }
      })
    ]);

    if (!dyn) return reply.status(404).send({ error: 'Dinamização não encontrada' });

    const dynConfig = {
      id: dyn.id,
      name: dyn.name,
      tierMode: dyn.tierMode as any,
      tiers: dyn.tiers.map((t: any) => ({
        minQuantity: t.minQuantity,
        maxQuantity: t.maxQuantity,
        unitAmountCents: t.unitAmountCents
      })),
      bonuses: dyn.bonuses.map((b: any) => ({
        thresholdCount: b.thresholdCount,
        bonusAmountCents: b.bonusAmountCents
      }))
    };

    const formattedSales = sales.map((s: any) => ({
      soldAt: s.soldAt,
      dynamizationId: s.dynamizationId,
      items: s.items.map((i: any) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents
      }))
    }));

    const simulation = HccallCommissionEngine.simulateAdditionalSales(
      formattedSales,
      dynConfig,
      body.additionalSalesCount
    );

    return reply.send({ success: true, simulation });
  }

  // -------------------------------------------------------------------------
  // SINCRONIZAÇÃO OFFLINE IDEMPOTENTE
  // -------------------------------------------------------------------------
  static async syncOfflineBatch(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { operations } = req.body as { operations: any[] };
    const db = forTenant(user.tenantId);

    const { results, summary } = await HccallSyncService.processBatch(db, user.tenantId, user.sub, operations || []);

    broadcastUserEvent(user.sub, 'sales_synced', results);
    return reply.send({ success: true, processed: results.length, results, summary });
  }

  // -------------------------------------------------------------------------
  // STREAM DE EVENTOS EM TEMPO REAL (SSE)
  // -------------------------------------------------------------------------
  static async streamEvents(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    if (!sseClients.has(user.sub)) {
      sseClients.set(user.sub, new Set());
    }
    sseClients.get(user.sub)!.add(reply);

    req.raw.on('close', () => {
      const clients = sseClients.get(user.sub);
      if (clients) {
        clients.delete(reply);
        if (clients.size === 0) sseClients.delete(user.sub);
      }
    });

    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to HCCALL live stream' })}\n\n`);
  }

  // -------------------------------------------------------------------------
  // MÉTODOS DE RETROCOMPATIBILIDADE (v1)
  // -------------------------------------------------------------------------
  static async listServices(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const services = await HccallConfigService.listServices(db, user.tenantId);
    return reply.send({ success: true, services });
  }

  static async createService(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = ServiceSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const service = await HccallConfigService.createService(db, user.tenantId, user.sub, body);
    return reply.status(201).send({ success: true, service });
  }

  static async updateService(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = ServiceSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const service = await HccallConfigService.updateService(db, user.tenantId, id, body);
    return reply.send({ success: true, service });
  }

  static async deleteService(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallConfigService.deleteService(db, user.tenantId, id);
    return reply.send({ success: true });
  }

  static async listPromotions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const promotions = await HccallConfigService.listPromotions(db, user.tenantId);
    return reply.send({ success: true, promotions });
  }

  static async createPromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = PromotionSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const promotion = await HccallConfigService.createPromotion(db, user.tenantId, user.sub, body);
    return reply.status(201).send({ success: true, promotion });
  }

  static async updatePromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = PromotionSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const promotion = await HccallConfigService.updatePromotion(db, user.tenantId, id, body);
    return reply.send({ success: true, promotion });
  }

  static async deletePromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallConfigService.deletePromotion(db, user.tenantId, id);
    return reply.send({ success: true });
  }

  static async listStatuses(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const statuses = await HccallConfigService.listSaleStatuses(db, user.tenantId);
    return reply.send({ success: true, statuses });
  }

  static async createStatus(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = StatusSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const status = await HccallConfigService.createSaleStatus(db, user.tenantId, body);
    return reply.status(201).send({ success: true, status });
  }

  static async updateStatus(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = StatusSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const status = await HccallConfigService.updateSaleStatus(db, user.tenantId, id, body);
    return reply.send({ success: true, status });
  }

  static async deleteStatus(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallConfigService.deleteSaleStatus(db, user.tenantId, id);
    return reply.send({ success: true });
  }

  static async listCustomers(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const customers = await HccallCustomerService.listCustomers(db, user.tenantId, user.sub, req.query as any);
    return reply.send({ success: true, customers });
  }

  static async getCustomer(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const result = await HccallCustomerService.getCustomerDetails(db, user.tenantId, user.sub, id);
    if (!result) return reply.status(404).send({ error: 'Cliente não encontrado' });
    return reply.send({ success: true, ...result });
  }

  static async addContact(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const contact = await HccallCustomerService.addContact(db, user.tenantId, user.sub, id, req.body as any);
    return reply.status(201).send({ success: true, contact });
  }

  static async anonymizeCustomer(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallCustomerService.anonymizeCustomer(db, user.tenantId, user.sub, id);
    return reply.send({ success: true });
  }

  static async getDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const [todaySales, monthSales] = await Promise.all([
      db.hccallSale.findMany({
        where: { tenantId: user.tenantId, ownerUserId: user.sub, soldAt: { gte: todayStart }, deletedAt: null }
      }),
      db.hccallSale.findMany({
        where: { tenantId: user.tenantId, ownerUserId: user.sub, soldAt: { gte: monthStart }, deletedAt: null }
      })
    ]);

    const todayCount = todaySales.length;
    const todayCommissionCents = todaySales.reduce((acc: number, s: any) => acc + (s.commissionCents || 0), 0);

    const monthCount = monthSales.length;
    const monthCommissionCents = monthSales.reduce((acc: number, s: any) => acc + (s.commissionCents || 0), 0);

    const byCommissionState = monthSales.reduce((acc: any, s: any) => {
      const st = s.commissionState || 'FORECAST';
      acc[st] = (acc[st] || 0) + (s.commissionCents || 0);
      return acc;
    }, { FORECAST: 0, CONFIRMED: 0, PAID: 0, VOID: 0 });

    return reply.send({
      success: true,
      today: {
        count: todayCount,
        totalCommissionCents: todayCommissionCents,
        statusBreakdown: {}
      },
      thisMonth: {
        count: monthCount,
        totalCommissionCents: monthCommissionCents,
        byCommissionState
      }
    });
  }

  static async exportSalesCsv(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const sales = await db.hccallSale.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.sub, deletedAt: null },
      orderBy: { soldAt: 'desc' }
    });

    const header = '\uFEFFCódigo;Cliente;Serviço;Promoção;Comissão;Estado;Data;Notas\r\n';
    const lines = sales.map((s: any) =>
      `${s.code};${s.customerNumber};${s.serviceName || 'Geral'};${s.promotionName || ''};${((s.commissionCents || 0) / 100).toFixed(2)} €;${s.statusId};${new Date(s.soldAt).toISOString().split('T')[0]};${s.notes || ''}`
    ).join('\r\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="hccall_vendas.csv"');
    return reply.send(header + lines);
  }
}
