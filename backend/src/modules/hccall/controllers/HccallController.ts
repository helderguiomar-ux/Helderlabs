import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { HccallConfigService } from '../services/HccallConfigService';
import { HccallSaleService } from '../services/HccallSaleService';
import { HccallCustomerService } from '../services/HccallCustomerService';
import { HccallSyncService } from '../services/HccallSyncService';

// ===========================================================================
// SCHEMAS DE VALIDAÇÃO ZOD
// ===========================================================================

const ServiceSchema = z.object({
  name: z.string().min(1, 'Nome do serviço é obrigatório'),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional()
});

const PromotionSchema = z.object({
  name: z.string().min(1, 'Nome da dinamização é obrigatório'),
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
  key: z.string().min(1, 'Chave do estado é obrigatória'),
  label: z.string().min(1, 'Nome visível do estado é obrigatório'),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isTerminal: z.boolean().optional(),
  commissionState: z.enum(['FORECAST', 'CONFIRMED', 'PAID', 'VOID']).optional()
});

const CreateSaleSchema = z.object({
  clientUuid: z.string().optional(),
  customerNumber: z.string().min(1, 'Número do cliente é obrigatório'),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().optional(),
  promotionId: z.string().optional(),
  commissionCents: z.number().int().optional(),
  saleValueCents: z.number().int().optional(),
  statusId: z.string().optional(),
  soldAt: z.string().optional(),
  notes: z.string().optional()
});

const UpdateSaleSchema = z.object({
  serviceId: z.string().optional(),
  promotionId: z.string().optional(),
  commissionCents: z.number().int().optional(),
  saleValueCents: z.number().int().optional(),
  statusId: z.string().optional(),
  soldAt: z.string().optional(),
  notes: z.string().optional(),
  reason: z.string().optional()
});

const SyncBatchSchema = z.object({
  operations: z.array(z.object({
    clientUuid: z.string().min(1),
    action: z.enum(['CREATE_SALE', 'UPDATE_SALE', 'CREATE_CONTACT']),
    payload: z.any(),
    occurredAt: z.string().optional()
  }))
});

export class HccallController {
  // =========================================================================
  // SERVIÇOS
  // =========================================================================

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
    return reply.send({ success: true, message: 'Serviço desativado com sucesso.' });
  }

  // =========================================================================
  // DINAMIZAÇÕES / PROMOÇÕES
  // =========================================================================

  static async listPromotions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { activeOnly } = req.query as { activeOnly?: string };
    const db = forTenant(user.tenantId);
    const promotions = await HccallConfigService.listPromotions(db, user.tenantId, activeOnly === 'true');
    return reply.send({ success: true, promotions });
  }

  static async createPromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = PromotionSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const promotion = await HccallConfigService.createPromotion(db, user.tenantId, user.sub, body as any);
    return reply.status(201).send({ success: true, promotion });
  }

  static async updatePromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = PromotionSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);
    const promotion = await HccallConfigService.updatePromotion(db, user.tenantId, id, body as any);
    return reply.send({ success: true, promotion });
  }

  static async deletePromotion(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallConfigService.deletePromotion(db, user.tenantId, id);
    return reply.send({ success: true, message: 'Dinamização arquivada com sucesso.' });
  }

  // =========================================================================
  // ESTADOS DE VENDA
  // =========================================================================

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
    return reply.send({ success: true, message: 'Estado removido com sucesso.' });
  }

  // =========================================================================
  // VENDAS
  // =========================================================================

  static async listSales(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as any;
    const db = forTenant(user.tenantId);
    const result = await HccallSaleService.listSales(db, user.tenantId, user.sub, query);
    return reply.send({ success: true, ...result });
  }

  static async getSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const sale = await HccallSaleService.getSaleById(db, user.tenantId, id);
    return reply.send({ success: true, sale });
  }

  static async createSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateSaleSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const res = await HccallSaleService.createSale(db, user.tenantId, user.sub, body);
    return reply.status(201).send({ success: true, sale: res.sale, isDuplicate: res.isDuplicate });
  }

  static async updateSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = UpdateSaleSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const updated = await HccallSaleService.updateSale(db, user.tenantId, user.sub, id, body);
    return reply.send({ success: true, sale: updated });
  }

  static async deleteSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallSaleService.deleteSale(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, message: 'Venda arquivada com sucesso.' });
  }

  static async restoreSale(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const sale = await HccallSaleService.restoreSale(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, sale });
  }

  // =========================================================================
  // CLIENTES
  // =========================================================================

  static async listCustomers(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as any;
    const db = forTenant(user.tenantId);
    const result = await HccallCustomerService.listCustomers(db, user.tenantId, user.sub, query);
    return reply.send({ success: true, ...result });
  }

  static async getCustomer(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    const details = await HccallCustomerService.getCustomerDetails(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, ...details });
  }

  static async addContact(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({
      kind: z.enum(['CALL', 'STORE', 'MESSAGE', 'NOTE']),
      summary: z.string().min(1),
      occurredAt: z.string().optional()
    }).parse(req.body);
    const db = forTenant(user.tenantId);
    const contact = await HccallCustomerService.addContact(db, user.tenantId, user.sub, id, body);
    return reply.status(201).send({ success: true, contact });
  }

  static async anonymizeCustomer(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);
    await HccallCustomerService.anonymizeCustomer(db, user.tenantId, user.sub, id);
    return reply.send({ success: true, message: 'Dados do cliente anonimizados em conformidade com o RGPD.' });
  }

  // =========================================================================
  // DASHBOARD & RELATÓRIOS
  // =========================================================================

  static async getDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);
    const metrics = await HccallSaleService.getSummaryMetrics(db, user.tenantId, user.sub);
    return reply.send({ success: true, ...metrics });
  }

  static async exportSalesCsv(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as any;
    const db = forTenant(user.tenantId);
    const { items } = await HccallSaleService.listSales(db, user.tenantId, user.sub, { ...query, limit: 200 });

    const bom = '\uFEFF';
    const header = 'Código;Cliente;Serviço;Dinamização;Comissão (€);Valor Venda (€);Estado;Data Venda;Notas\n';
    const rows = items.map((s: any) =>
      `"${s.code}";"${s.customerNumber}";"${s.serviceName || ''}";"${s.promotionName || ''}";"${(s.commissionCents / 100).toFixed(2)}";"${s.saleValueCents ? (s.saleValueCents / 100).toFixed(2) : ''}";"${s.statusLabel}";"${new Date(s.soldAt).toISOString().substring(0, 10)}";"${(s.notes || '').replace(/"/g, '""')}"`
    ).join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="hccall_vendas.csv"');
    return reply.send(bom + header + rows);
  }

  // =========================================================================
  // SINCRONIZAÇÃO OFFLINE
  // =========================================================================

  static async syncOfflineBatch(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = SyncBatchSchema.parse(req.body);
    const db = forTenant(user.tenantId);
    const syncRes = await HccallSyncService.processBatch(db, user.tenantId, user.sub, body.operations as any);
    return reply.send({ success: true, ...syncRes });
  }

  // =========================================================================
  // CONSULTAS IA (LISTA FECHADA & SEGURA)
  // =========================================================================

  static async handleAiQuery(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = z.object({
      intent: z.enum(['SUMMARY_TODAY', 'COMMISSIONS_MONTH', 'TOP_SERVICES', 'RECENT_CHANGES'])
    }).parse(req.body);

    const db = forTenant(user.tenantId);
    if (body.intent === 'SUMMARY_TODAY' || body.intent === 'COMMISSIONS_MONTH') {
      const metrics = await HccallSaleService.getSummaryMetrics(db, user.tenantId, user.sub);
      return reply.send({ success: true, data: metrics });
    }

    if (body.intent === 'TOP_SERVICES') {
      const { items } = await HccallSaleService.listSales(db, user.tenantId, user.sub, { limit: 100 });
      const counts: Record<string, number> = {};
      for (const s of items) {
        counts[s.serviceName] = (counts[s.serviceName] || 0) + 1;
      }
      return reply.send({ success: true, topServices: counts });
    }

    if (body.intent === 'RECENT_CHANGES') {
      const changes = await db.hccallSaleChange.findMany({
        where: { tenantId: user.tenantId },
        take: 20,
        orderBy: { changedAt: 'desc' }
      });
      return reply.send({ success: true, recentChanges: changes });
    }

    return reply.status(400).send({ error: 'INVALID_INTENT', message: 'Pergunta não suportada.' });
  }
}
