import { HccallCounterService } from './HccallCounterService';
import { HccallCustomerService } from './HccallCustomerService';
import { HccallCommissionEngine } from './HccallCommissionEngine';
import { HccallScopeService } from './HccallScopeService';
import crypto from 'node:crypto';

export class HccallSaleService {
  /**
   * Cria uma nova venda com código sequencial, snapshot imutável e recálculo automático de objetivos.
   */
  static async createSale(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      clientUuid?: string;
      customerNumber?: string;
      customerName?: string;
      customerPhone?: string;
      serviceId?: string;
      serviceName?: string;
      promotionId?: string;
      dynamizationId?: string;
      productId?: string;
      quantity?: number;
      items?: { productId: string; quantity: number; unitPriceCents?: number }[];
      commissionCents?: number;
      saleValueCents?: number;
      statusId?: string;
      soldAt?: string | Date;
      notes?: string;
      orgContextId?: string;
    }
  ) {
    const clientUuid = data.clientUuid || crypto.randomUUID();

    const executeInTx = async (tx: any) => {
      // 1. Verificar idempotência por clientUuid
      const existing = await tx.hccallSale.findUnique({
        where: {
          tenantId_clientUuid: {
            tenantId,
            clientUuid
          }
        },
        include: { items: true }
      });
      if (existing) {
        return { sale: existing, isDuplicate: true };
      }

      // 2. Resolver Cliente
      let customerId: string | null = null;
      if (data.customerNumber) {
        const customer = await HccallCustomerService.findOrCreateCustomer(tx, tenantId, userId, {
          customerNumber: data.customerNumber,
          name: data.customerName,
          phone: data.customerPhone
        });
        customerId = customer.id;
      }

      // 3. Resolver Contexto Organizacional Atual
      let orgContextId = data.orgContextId;
      if (!orgContextId) {
        const currentCtx = await tx.hccallOrgContext.findFirst({
          where: { tenantId, userId, isCurrent: true }
        });
        if (currentCtx) orgContextId = currentCtx.id;
      }

      // 4. Resolver Itens e Valor da Venda
      const itemsToCreate: { productId: string; quantity: number; unitPriceCents: number; totalPriceCents: number }[] = [];
      let calculatedTotalValueCents = 0;
      let primaryServiceName = data.serviceName || 'Geral';

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const prod = await tx.hccallProduct.findUnique({ where: { id: item.productId } });
          const price = item.unitPriceCents ?? prod?.baseValueCents ?? 0;
          const qty = item.quantity || 1;
          const total = price * qty;
          calculatedTotalValueCents += total;
          if (prod) primaryServiceName = prod.name;
          itemsToCreate.push({
            productId: item.productId,
            quantity: qty,
            unitPriceCents: price,
            totalPriceCents: total
          });
        }
      } else if (data.productId) {
        const prod = await tx.hccallProduct.findUnique({ where: { id: data.productId } });
        const qty = data.quantity || 1;
        const price = prod?.baseValueCents || 0;
        const total = price * qty;
        calculatedTotalValueCents = total;
        if (prod) primaryServiceName = prod.name;
        itemsToCreate.push({
          productId: data.productId,
          quantity: qty,
          unitPriceCents: price,
          totalPriceCents: total
        });
      }

      // 5. Resolver Dinamização & Snapshot Imutável
      let dynamizationSnapshot: any = null;
      let effectiveCommissionCents = data.commissionCents ?? 0;
      const dynId = data.dynamizationId || data.promotionId;

      if (dynId) {
        const dyn = await tx.hccallDynamization.findUnique({
          where: { id: dynId },
          include: { tiers: true, bonuses: true }
        });

        if (dyn) {
          dynamizationSnapshot = {
            id: dyn.id,
            name: dyn.name,
            tierMode: dyn.tierMode,
            version: dyn.version,
            tiers: dyn.tiers,
            bonuses: dyn.bonuses,
            capturedAt: new Date().toISOString()
          };

          if (data.commissionCents === undefined) {
            const totalQty = itemsToCreate.reduce((a, b) => a + b.quantity, 0) || 1;
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
            const calc = HccallCommissionEngine.calculateDynamization(dynConfig, totalQty);
            effectiveCommissionCents = calc.totalCommissionCents;
          }
        } else {
          // Retrocompatibilidade com HccallPromotion
          const promo = await tx.hccallPromotion.findUnique({ where: { id: dynId } });
          if (promo) {
            dynamizationSnapshot = {
              id: promo.id,
              name: promo.name,
              suggestedCommissionCents: promo.suggestedCommissionCents,
              promoValueCents: promo.promoValueCents,
              serviceId: promo.serviceId,
              version: promo.version,
              startsAt: promo.startsAt,
              endsAt: promo.endsAt,
              capturedAt: new Date().toISOString()
            };
            if (data.commissionCents === undefined) {
              effectiveCommissionCents = promo.suggestedCommissionCents;
            }
          }
        }
      }

      // 6. Gerar Código Sequencial Canónico
      const soldDate = data.soldAt ? new Date(data.soldAt) : new Date();
      const code = await HccallCounterService.nextSaleCode(tx, tenantId, soldDate.getFullYear());

      // 7. Criar Venda no Banco de Dados
      const sale = await tx.hccallSale.create({
        data: {
          tenantId,
          ownerUserId: userId,
          orgContextId,
          code,
          clientUuid,
          customerId,
          customerNumber: data.customerNumber || 'N/A',
          serviceName: primaryServiceName,
          serviceId: data.serviceId,
          promotionId: data.promotionId,
          promotionSnapshot: dynamizationSnapshot,
          dynamizationId: data.dynamizationId,
          dynamizationSnapshot,
          commissionCents: effectiveCommissionCents,
          saleValueCents: data.saleValueCents ?? calculatedTotalValueCents,
          statusId: data.statusId || 'registada',
          soldAt: soldDate,
          notes: data.notes,
          items: itemsToCreate.length > 0 ? {
            create: itemsToCreate.map(item => ({
              tenantId,
              productId: item.productId,
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              totalPriceCents: item.totalPriceCents
            }))
          } : undefined
        },
        include: { items: { include: { product: true } } }
      });

      // 8. Atualizar Progresso de Objetivos Ativos
      try {
        const activeObjectives = await tx.hccallObjective.findMany({
          where: {
            tenantId,
            userId,
            periodStart: { lte: soldDate },
            periodEnd: { gte: soldDate },
            deletedAt: null
          }
        });

        for (const obj of activeObjectives) {
          if (obj.type === 'SALES_COUNT') {
            await tx.hccallObjective.update({
              where: { id: obj.id },
              data: { currentValue: { increment: 1 } }
            });
          } else if (obj.type === 'REVENUE') {
            await tx.hccallObjective.update({
              where: { id: obj.id },
              data: { currentValue: { increment: sale.saleValueCents || 0 } }
            });
          }
        }
      } catch (_) {}

      return { sale, isDuplicate: false };
    };

    if (db.$transaction) {
      return db.$transaction(executeInTx);
    }
    return executeInTx(db);
  }

  static async listSales(
    db: any,
    tenantId: string,
    userId: string,
    query: {
      limit?: number;
      offset?: number;
      statusId?: string;
      dynamizationId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    } = {}
  ) {
    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);
    const where: any = {
      tenantId,
      ...scope,
      deletedAt: null
    };

    if (query.statusId) where.statusId = query.statusId;
    if (query.dynamizationId) where.dynamizationId = query.dynamizationId;
    if (query.startDate || query.endDate) {
      where.soldAt = {};
      if (query.startDate) where.soldAt.gte = new Date(query.startDate);
      if (query.endDate) where.soldAt.lte = new Date(query.endDate);
    }
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { customerNumber: { contains: query.search, mode: 'insensitive' } },
        { serviceName: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const [total, sales] = await Promise.all([
      db.hccallSale.count({ where }),
      db.hccallSale.findMany({
        where,
        include: {
          items: { include: { product: true } },
          dynamization: true,
          changes: true
        },
        orderBy: { soldAt: 'desc' },
        take: query.limit ? Number(query.limit) : 50,
        skip: query.offset ? Number(query.offset) : 0
      })
    ]);

    return { total, sales };
  }

  static async getSale(db: any, tenantId: string, userId: string, id: string) {
    return this.getSaleById(db, tenantId, userId, id);
  }

  static async getSaleById(db: any, tenantId: string, userId: string, id: string) {
    const sale = await db.hccallSale.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        dynamization: true,
        changes: { orderBy: { changedAt: 'desc' } }
      }
    });

    if (!sale || sale.tenantId !== tenantId) {
      throw new Error('Não tem permissão para visualizar esta venda.');
    }

    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);
    if (scope.ownerUserId && sale.ownerUserId !== userId) {
      throw new Error('Não tem permissão para visualizar esta venda.');
    }

    return sale;
  }

  static async updateSale(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    data: {
      statusId?: string;
      commissionCents?: number;
      notes?: string;
      reason?: string;
    }
  ) {
    const execute = async (tx: any) => {
      const existing = await tx.hccallSale.findUnique({
        where: { id }
      });

      if (!existing || existing.tenantId !== tenantId) {
        throw new Error('Não tem permissão para editar esta venda.');
      }

      const scope = await HccallScopeService.getVisibilityScope(tx, tenantId, userId);
      if (scope.ownerUserId && existing.ownerUserId !== userId) {
        throw new Error('Não tem permissão para editar esta venda.');
      }

      if (data.commissionCents !== undefined && data.commissionCents !== existing.commissionCents) {
        await tx.hccallSaleChange.create({
          data: {
            tenantId,
            saleId: id,
            field: 'commissionCents',
            oldValue: `${(existing.commissionCents / 100).toFixed(2)} €`,
            newValue: `${(data.commissionCents / 100).toFixed(2)} €`,
            reason: data.reason || 'Ajustamento manual de comissão',
            changedByUserId: userId
          }
        });
      }

      if (data.statusId && data.statusId !== existing.statusId) {
        await tx.hccallSaleChange.create({
          data: {
            tenantId,
            saleId: id,
            field: 'statusId',
            oldValue: existing.statusId,
            newValue: data.statusId,
            reason: data.reason || 'Atualização de estado da venda',
            changedByUserId: userId
          }
        });
      }

      return tx.hccallSale.update({
        where: { id },
        data: {
          statusId: data.statusId,
          commissionCents: data.commissionCents,
          notes: data.notes
        },
        include: { items: true, changes: true }
      });
    };

    if (db.$transaction) {
      return db.$transaction(execute);
    }
    return execute(db);
  }

  static async deleteSale(db: any, tenantId: string, userId: string, id: string) {
    const existing = await db.hccallSale.findUnique({ where: { id } });
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error('Não tem permissão para eliminar esta venda.');
    }

    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);
    if (scope.ownerUserId && existing.ownerUserId !== userId) {
      throw new Error('Não tem permissão para eliminar esta venda.');
    }

    return db.hccallSale.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }
}
