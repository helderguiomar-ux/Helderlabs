import { HccallCounterService } from './HccallCounterService';
import { HccallScopeService } from './HccallScopeService';
import { HccallCustomerService } from './HccallCustomerService';
import crypto from 'node:crypto';

export class HccallSaleService {
  /**
   * Creates a new sale with atomic code, locked commission and immutable promotion snapshot.
   */
  static async createSale(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      clientUuid?: string;
      customerNumber: string;
      customerName?: string;
      customerPhone?: string;
      serviceId?: string;
      serviceName?: string;
      promotionId?: string;
      commissionCents?: number;
      saleValueCents?: number;
      statusId?: string;
      soldAt?: string | Date;
      notes?: string;
    }
  ) {
    const clientUuid = data.clientUuid || crypto.randomUUID();

    // Check idempotency
    const existing = await db.hccallSale.findUnique({
      where: {
        tenantId_clientUuid: {
          tenantId,
          clientUuid
        }
      }
    });
    if (existing) {
      return { sale: existing, isDuplicate: true };
    }

    // 1. Resolve Customer
    const customer = await HccallCustomerService.findOrCreateCustomer(db, tenantId, userId, {
      customerNumber: data.customerNumber,
      name: data.customerName,
      phone: data.customerPhone
    });

    // 2. Resolve Service
    let serviceName = data.serviceName || 'Geral';
    if (data.serviceId) {
      const s = await db.hccallService.findUnique({ where: { id: data.serviceId } });
      if (s) serviceName = s.name;
    }

    // 3. Resolve Promotion & Immutable Snapshot
    let promotionName: string | null = null;
    let promotionVersion: number | null = null;
    let promotionSnapshot: any = null;
    let effectiveCommissionCents = data.commissionCents ?? 0;

    if (data.promotionId) {
      const promo = await db.hccallPromotion.findUnique({ where: { id: data.promotionId } });
      if (promo) {
        promotionName = promo.name;
        promotionVersion = promo.version;
        promotionSnapshot = {
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

    // 4. Resolve Status
    let statusId = data.statusId;
    if (!statusId) {
      const defaultStatus = await db.hccallSaleStatus.findFirst({
        where: { tenantId, key: 'registada', deletedAt: null }
      }) || await db.hccallSaleStatus.findFirst({
        where: { tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' }
      });
      statusId = defaultStatus?.id || 'registada';
    }

    // 5. Generate Atomic Code
    const code = await HccallCounterService.getNextSaleCode(db, tenantId);

    // 6. Persist Sale
    const soldAt = data.soldAt ? new Date(data.soldAt) : new Date();

    const sale = await db.hccallSale.create({
      data: {
        tenantId,
        ownerUserId: userId,
        code,
        clientUuid,
        customerId: customer.id,
        customerNumber: customer.customerNumber,
        serviceId: data.serviceId || null,
        serviceName,
        promotionId: data.promotionId || null,
        promotionName,
        promotionVersion,
        promotionSnapshot,
        commissionCents: Math.round(effectiveCommissionCents),
        saleValueCents: data.saleValueCents ? Math.round(data.saleValueCents) : null,
        statusId,
        soldAt,
        notes: data.notes || null
      }
    });

    // 7. Record initial Change event
    await db.hccallSaleChange.create({
      data: {
        tenantId,
        saleId: sale.id,
        field: 'CREATED',
        oldValue: null,
        newValue: `Venda ${sale.code} registada (${(sale.commissionCents / 100).toFixed(2)} €)`,
        reason: 'Criação inicial da venda',
        changedByUserId: userId
      }
    }).catch(() => {});

    return { sale, isDuplicate: false };
  }

  /**
   * Updates an existing sale and tracks all field mutations in HccallSaleChange.
   */
  static async updateSale(
    db: any,
    tenantId: string,
    userId: string,
    saleId: string,
    data: {
      serviceId?: string;
      promotionId?: string;
      commissionCents?: number;
      saleValueCents?: number;
      statusId?: string;
      soldAt?: string | Date;
      notes?: string;
      reason?: string;
    }
  ) {
    const existing = await db.hccallSale.findUnique({
      where: { id: saleId }
    });

    if (!existing || existing.tenantId !== tenantId) {
      throw new Error('Venda não encontrada.');
    }

    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
    const updateData: any = {};

    // Check Status change
    if (data.statusId && data.statusId !== existing.statusId) {
      const oldStatus = await db.hccallSaleStatus.findUnique({ where: { id: existing.statusId } });
      const newStatus = await db.hccallSaleStatus.findUnique({ where: { id: data.statusId } });
      changes.push({
        field: 'statusId',
        oldValue: oldStatus?.label || existing.statusId,
        newValue: newStatus?.label || data.statusId
      });
      updateData.statusId = data.statusId;
    }

    // Check Commission change
    if (data.commissionCents !== undefined && Math.round(data.commissionCents) !== existing.commissionCents) {
      const newComm = Math.round(data.commissionCents);
      changes.push({
        field: 'commissionCents',
        oldValue: `${(existing.commissionCents / 100).toFixed(2)} €`,
        newValue: `${(newComm / 100).toFixed(2)} €`
      });
      updateData.commissionCents = newComm;
    }

    // Check Sale Value change
    if (data.saleValueCents !== undefined && Math.round(data.saleValueCents) !== existing.saleValueCents) {
      const newSaleVal = Math.round(data.saleValueCents);
      changes.push({
        field: 'saleValueCents',
        oldValue: existing.saleValueCents ? `${(existing.saleValueCents / 100).toFixed(2)} €` : 'N/A',
        newValue: `${(newSaleVal / 100).toFixed(2)} €`
      });
      updateData.saleValueCents = newSaleVal;
    }

    // Check Service change
    if (data.serviceId !== undefined && data.serviceId !== existing.serviceId) {
      let newServiceName = 'Geral';
      if (data.serviceId) {
        const s = await db.hccallService.findUnique({ where: { id: data.serviceId } });
        if (s) newServiceName = s.name;
      }
      changes.push({
        field: 'serviceId',
        oldValue: existing.serviceName,
        newValue: newServiceName
      });
      updateData.serviceId = data.serviceId;
      updateData.serviceName = newServiceName;
    }

    // Check Promotion change
    if (data.promotionId !== undefined && data.promotionId !== existing.promotionId) {
      let newPromoName: string | null = null;
      let newPromoVersion: number | null = null;
      let newSnapshot: any = null;

      if (data.promotionId) {
        const promo = await db.hccallPromotion.findUnique({ where: { id: data.promotionId } });
        if (promo) {
          newPromoName = promo.name;
          newPromoVersion = promo.version;
          newSnapshot = {
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
        }
      }

      changes.push({
        field: 'promotionId',
        oldValue: existing.promotionName || 'Sem Dinamização',
        newValue: newPromoName || 'Sem Dinamização'
      });
      updateData.promotionId = data.promotionId;
      updateData.promotionName = newPromoName;
      updateData.promotionVersion = newPromoVersion;
      updateData.promotionSnapshot = newSnapshot;
    }

    // Check Notes change
    if (data.notes !== undefined && data.notes !== existing.notes) {
      changes.push({
        field: 'notes',
        oldValue: existing.notes || '',
        newValue: data.notes || ''
      });
      updateData.notes = data.notes;
    }

    if (data.soldAt) {
      updateData.soldAt = new Date(data.soldAt);
    }

    // Apply update
    const updated = await db.hccallSale.update({
      where: { id: saleId },
      data: updateData
    });

    // Record change events
    const reasonText = data.reason || 'Edição de venda';
    for (const c of changes) {
      await db.hccallSaleChange.create({
        data: {
          tenantId,
          saleId,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          reason: reasonText,
          changedByUserId: userId
        }
      }).catch(() => {});
    }

    return updated;
  }

  static async getSaleById(db: any, tenantId: string, id: string) {
    const sale = await db.hccallSale.findUnique({
      where: { id },
      include: {
        changes: {
          orderBy: { changedAt: 'desc' }
        }
      }
    });

    if (!sale || sale.tenantId !== tenantId) {
      throw new Error('Venda não encontrada.');
    }

    const status = await db.hccallSaleStatus.findUnique({ where: { id: sale.statusId } });

    return {
      ...sale,
      statusLabel: status?.label || sale.statusId,
      statusColor: status?.color || '#6b7280',
      commissionState: status?.commissionState || 'FORECAST'
    };
  }

  static async listSales(
    db: any,
    tenantId: string,
    userId: string,
    query: {
      search?: string;
      statusId?: string;
      serviceId?: string;
      promotionId?: string;
      startDate?: string;
      endDate?: string;
      commissionState?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);
    const take = Math.min(query.limit ? Number(query.limit) : 50, 200);
    const skip = query.offset ? Number(query.offset) : 0;

    const where: any = {
      tenantId,
      deletedAt: null,
      ...scope
    };

    if (query.statusId) where.statusId = query.statusId;
    if (query.serviceId) where.serviceId = query.serviceId;
    if (query.promotionId) where.promotionId = query.promotionId;

    if (query.startDate || query.endDate) {
      where.soldAt = {};
      if (query.startDate) where.soldAt.gte = new Date(query.startDate);
      if (query.endDate) where.soldAt.lte = new Date(query.endDate);
    }

    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { customerNumber: { contains: q, mode: 'insensitive' } },
        { serviceName: { contains: q, mode: 'insensitive' } },
        { promotionName: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [sales, total, statuses] = await Promise.all([
      db.hccallSale.findMany({
        where,
        take,
        skip,
        orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }]
      }),
      db.hccallSale.count({ where }),
      db.hccallSaleStatus.findMany({ where: { tenantId } })
    ]);

    const statusMap = new Map<string, any>(statuses.map((s: any) => [s.id, s]));

    const items = sales.map((sale: any) => {
      const st = statusMap.get(sale.statusId);
      return {
        ...sale,
        statusLabel: st?.label || sale.statusId,
        statusColor: st?.color || '#6b7280',
        commissionState: st?.commissionState || 'FORECAST'
      };
    });

    return {
      items,
      total,
      limit: take,
      offset: skip
    };
  }

  static async deleteSale(db: any, tenantId: string, userId: string, id: string) {
    return db.hccallSale.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  static async restoreSale(db: any, tenantId: string, userId: string, id: string) {
    return db.hccallSale.update({
      where: { id },
      data: { deletedAt: null }
    });
  }

  /**
   * Computes operational dashboard and commission reports according to commissionState.
   */
  static async getSummaryMetrics(db: any, tenantId: string, userId: string) {
    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todaySales, monthSales, allStatuses] = await Promise.all([
      db.hccallSale.findMany({
        where: {
          tenantId,
          deletedAt: null,
          soldAt: { gte: todayStart },
          ...scope
        }
      }),
      db.hccallSale.findMany({
        where: {
          tenantId,
          deletedAt: null,
          soldAt: { gte: monthStart },
          ...scope
        }
      }),
      db.hccallSaleStatus.findMany({ where: { tenantId } })
    ]);

    const statusMap = new Map<string, any>(allStatuses.map((s: any) => [s.id, s]));

    const aggregateMetrics = (salesList: any[]) => {
      let count = salesList.length;
      let totalCommissionCents = 0;
      let confirmedCommissionCents = 0;
      let paidCommissionCents = 0;
      let forecastCommissionCents = 0;
      let voidCommissionCents = 0;

      const statusBreakdown: Record<string, number> = {};

      for (const s of salesList) {
        const st = statusMap.get(s.statusId);
        const commState = st?.commissionState || 'FORECAST';
        const cents = s.commissionCents || 0;

        totalCommissionCents += cents;
        if (commState === 'CONFIRMED') confirmedCommissionCents += cents;
        else if (commState === 'PAID') paidCommissionCents += cents;
        else if (commState === 'FORECAST') forecastCommissionCents += cents;
        else if (commState === 'VOID') voidCommissionCents += cents;

        const statusLabel = st?.label || s.statusId;
        statusBreakdown[statusLabel] = (statusBreakdown[statusLabel] || 0) + 1;
      }

      return {
        count,
        totalCommissionCents,
        confirmedCommissionCents,
        paidCommissionCents,
        forecastCommissionCents,
        voidCommissionCents,
        statusBreakdown
      };
    };

    return {
      today: aggregateMetrics(todaySales),
      thisMonth: aggregateMetrics(monthSales)
    };
  }
}
