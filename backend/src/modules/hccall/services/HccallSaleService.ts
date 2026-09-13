import { HccallCounterService } from './HccallCounterService';
import { HccallCustomerService } from './HccallCustomerService';
import { HccallCommissionEngine } from './HccallCommissionEngine';
import { HccallScopeService } from './HccallScopeService';
import crypto from 'node:crypto';

export class HccallSaleService {
  /**
   * Executa transição lazy de vendas cujo estado era 'scheduled' e cuja data foi atingida.
   */
  public static async triggerLazyStateTransitions(db: any, tenantId: string) {
    try {
      const now = new Date();
      const overdueScheduled = await db.hccallSale.findMany({
        where: {
          tenantId,
          statusId: 'scheduled',
          soldAt: { lte: now },
          deletedAt: null
        }
      });

      for (const s of overdueScheduled) {
        const executeTransition = async (tx: any) => {
          await tx.hccallSale.update({
            where: { id: s.id },
            data: {
              statusId: 'registada',
              closedAt: new Date(),
              version: { increment: 1 }
            }
          });
          await tx.hccallSaleEvent.create({
            data: {
              tenantId,
              saleId: s.id,
              action: 'TRANSITIONED',
              actorUserId: 'system',
              beforeState: { statusId: 'scheduled' },
              afterState: { statusId: 'registada', closedAt: new Date() },
              reason: 'Transição automática de agendada para registada (data atingida)'
            }
          });
        };

        if (db.$transaction) {
          await db.$transaction(executeTransition);
        } else {
          await executeTransition(db);
        }
      }
    } catch (_) {
      // Ignorar erros secundários de lazy transition sem bloquear a leitura
    }
  }

  /**
   * Cria uma nova venda com isolamento estrito de tenant, código sequencial,
   * snapshot imutável de comissão, máquina de estados e histórico de eventos.
   */
  static async createSale(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      clientUuid?: string;
      customerNumber?: string;
      orderNumber?: string;
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

      // 4. Resolver Itens e Valor da Venda com Isolamento Estrito de Tenant
      const itemsToCreate: { productId: string; quantity: number; unitPriceCents: number; totalPriceCents: number }[] = [];
      let calculatedTotalValueCents = 0;
      let primaryServiceName = data.serviceName || 'Geral';

      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const prod = await tx.hccallProduct.findFirst({
            where: { id: item.productId, tenantId, deletedAt: null }
          });
          if (!prod) {
            throw new Error(`Produto ${item.productId} não encontrado ou pertence a outro tenant.`);
          }
          const price = item.unitPriceCents ?? prod.baseValueCents ?? 0;
          const qty = item.quantity || 1;
          const total = price * qty;
          calculatedTotalValueCents += total;
          primaryServiceName = prod.name;
          itemsToCreate.push({
            productId: item.productId,
            quantity: qty,
            unitPriceCents: price,
            totalPriceCents: total
          });
        }
      } else if (data.productId) {
        const prod = await tx.hccallProduct.findFirst({
          where: { id: data.productId, tenantId, deletedAt: null }
        });
        if (!prod) {
          throw new Error(`Produto ${data.productId} não encontrado ou pertence a outro tenant.`);
        }
        const qty = data.quantity || 1;
        const price = prod.baseValueCents || 0;
        const total = price * qty;
        calculatedTotalValueCents = total;
        primaryServiceName = prod.name;
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
        const dyn = await tx.hccallDynamization.findFirst({
          where: { id: dynId, tenantId, deletedAt: null },
          include: { tiers: true, bonuses: true }
        });

        if (dyn) {
          dynamizationSnapshot = {
            id: dyn.id,
            name: dyn.name,
            tierMode: dyn.tierMode,
            bonusMode: (dyn as any).bonusMode || (dyn as any).bonus_mode || 'milestone',
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
              bonusMode: (dyn as any).bonusMode || (dyn as any).bonus_mode || 'milestone',
              baseAmountPerSaleCents: dyn.baseAmountPerSaleCents,
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
          const promo = await tx.hccallPromotion.findFirst({
            where: { id: dynId, tenantId, deletedAt: null }
          });
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
          } else {
            throw new Error(`Dinamização ${dynId} não encontrada ou pertence a outro tenant.`);
          }
        }
      }

      // 6. Gerar Código Sequencial Canónico e Tratar Máquina de Estados
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      const soldDate = data.soldAt ? new Date(data.soldAt) : new Date();
      const isFuture = soldDate.getTime() > todayEnd.getTime();
      const isBackdated = soldDate.getTime() < todayStart.getTime();

      const finalStatusId = isFuture ? 'scheduled' : (data.statusId || 'registada');
      const scheduledConfirmedAt = isFuture ? new Date() : null;
      const closedAt = isFuture ? null : new Date();

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
          orderNumber: data.orderNumber || null,
          serviceName: primaryServiceName,
          serviceId: data.serviceId,
          promotionId: data.promotionId,
          promotionSnapshot: dynamizationSnapshot,
          dynamizationId: data.dynamizationId,
          dynamizationSnapshot,
          commissionCents: effectiveCommissionCents,
          saleValueCents: data.saleValueCents ?? calculatedTotalValueCents,
          statusId: finalStatusId,
          soldAt: soldDate,
          notes: data.notes,
          scheduledConfirmedAt,
          closedAt,
          isBackdated,
          version: 1,
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

      // 8. Registar Evento de Criação da Ficha de Venda
      await tx.hccallSaleEvent.create({
        data: {
          tenantId,
          saleId: sale.id,
          action: 'CREATED',
          actorUserId: userId,
          beforeState: null,
          afterState: {
            code: sale.code,
            statusId: sale.statusId,
            commissionCents: sale.commissionCents,
            saleValueCents: sale.saleValueCents,
            soldAt: sale.soldAt,
            isBackdated: sale.isBackdated
          },
          reason: isFuture ? 'Venda futura agendada' : (isBackdated ? 'Venda retroativa registada' : 'Registo de venda')
        }
      });

      // 9. Atualizar Progresso de Objetivos Ativos (Apenas para vendas closed / não agendadas)
      if (!isFuture) {
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
      }

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
    // Executa lazy transitions antes da listagem
    await this.triggerLazyStateTransitions(db, tenantId);

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
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
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
          changes: true,
          events: { orderBy: { timestamp: 'desc' } }
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
    await this.triggerLazyStateTransitions(db, tenantId);

    const sale = await db.hccallSale.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        dynamization: true,
        changes: { orderBy: { changedAt: 'desc' } },
        events: { orderBy: { timestamp: 'desc' } }
      }
    });

    if (!sale || sale.tenantId !== tenantId || Boolean(sale.deletedAt)) {
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

      if (!existing || existing.tenantId !== tenantId || Boolean(existing.deletedAt)) {
        throw new Error('Não tem permissão para editar esta venda.');
      }

      const scope = await HccallScopeService.getVisibilityScope(tx, tenantId, userId);
      if (scope.ownerUserId && existing.ownerUserId !== userId) {
        throw new Error('Não tem permissão para editar esta venda.');
      }

      const beforeState = {
        statusId: existing.statusId,
        commissionCents: existing.commissionCents,
        notes: existing.notes
      };

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

      const updated = await tx.hccallSale.update({
        where: { id },
        data: {
          statusId: data.statusId,
          commissionCents: data.commissionCents,
          notes: data.notes,
          version: { increment: 1 }
        },
        include: { items: true, changes: true, events: true }
      });

      await tx.hccallSaleEvent.create({
        data: {
          tenantId,
          saleId: id,
          action: 'UPDATED',
          actorUserId: userId,
          beforeState,
          afterState: {
            statusId: updated.statusId,
            commissionCents: updated.commissionCents,
            notes: updated.notes
          },
          reason: data.reason || 'Edição de dados da venda'
        }
      });

      return updated;
    };

    if (db.$transaction) {
      return db.$transaction(execute);
    }
    return execute(db);
  }

  static async deleteSale(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    deleteReason: string = 'Eliminação solicitada pelo operador'
  ) {
    const execute = async (tx: any) => {
      const existing = await tx.hccallSale.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId || Boolean(existing.deletedAt)) {
        throw new Error('Não tem permissão para eliminar esta venda.');
      }

      const scope = await HccallScopeService.getVisibilityScope(tx, tenantId, userId);
      if (scope.ownerUserId && existing.ownerUserId !== userId) {
        throw new Error('Não tem permissão para eliminar esta venda.');
      }

      const updated = await tx.hccallSale.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
          deleteReason,
          version: { increment: 1 }
        }
      });

      await tx.hccallSaleEvent.create({
        data: {
          tenantId,
          saleId: id,
          action: 'SOFT_DELETED',
          actorUserId: userId,
          beforeState: { code: existing.code, statusId: existing.statusId },
          afterState: { deletedAt: updated.deletedAt, deletedBy: userId, deleteReason },
          reason: deleteReason
        }
      });

      return updated;
    };

    if (db.$transaction) {
      return db.$transaction(execute);
    }
    return execute(db);
  }
}
