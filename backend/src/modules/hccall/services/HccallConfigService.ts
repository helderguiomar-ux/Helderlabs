export class HccallConfigService {
  // =========================================================================
  // SERVIÇOS
  // =========================================================================

  static async listServices(db: any, tenantId: string) {
    await this.ensureDefaults(db, tenantId);
    return db.hccallService.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    });
  }

  static async createService(db: any, tenantId: string, userId: string, data: {
    name: string;
    color?: string;
    sortOrder?: number;
    active?: boolean;
  }) {
    return db.hccallService.create({
      data: {
        tenantId,
        ownerUserId: userId,
        name: data.name.trim(),
        color: data.color || '#0d419f',
        sortOrder: data.sortOrder ?? 100,
        active: data.active ?? true
      }
    });
  }

  static async updateService(db: any, tenantId: string, id: string, data: {
    name?: string;
    color?: string;
    sortOrder?: number;
    active?: boolean;
  }) {
    return db.hccallService.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.active !== undefined && { active: data.active })
      }
    });
  }

  static async deleteService(db: any, tenantId: string, id: string) {
    return db.hccallService.update({
      where: { id },
      data: { deletedAt: new Date(), active: false }
    });
  }

  // =========================================================================
  // DINAMIZAÇÕES / PROMOÇÕES
  // =========================================================================

  static async listPromotions(db: any, tenantId: string, activeOnly: boolean = false) {
    await this.ensureDefaults(db, tenantId);
    const where: any = { tenantId, deletedAt: null };
    if (activeOnly) {
      where.active = true;
    }
    return db.hccallPromotion.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }]
    });
  }

  static async createPromotion(db: any, tenantId: string, userId: string, data: {
    name: string;
    description?: string | null;
    serviceId?: string | null;
    suggestedCommissionCents?: number;
    promoValueCents?: number | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    active?: boolean;
    notes?: string | null;
  }) {
    return db.hccallPromotion.create({
      data: {
        tenantId,
        ownerUserId: userId,
        name: data.name.trim(),
        description: data.description || null,
        serviceId: data.serviceId || null,
        suggestedCommissionCents: Math.round(data.suggestedCommissionCents || 0),
        promoValueCents: data.promoValueCents ? Math.round(data.promoValueCents) : null,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        active: data.active ?? true,
        notes: data.notes || null,
        version: 1
      }
    });
  }

  static async updatePromotion(db: any, tenantId: string, id: string, data: {
    name?: string;
    description?: string | null;
    serviceId?: string | null;
    suggestedCommissionCents?: number;
    promoValueCents?: number | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    active?: boolean;
    notes?: string | null;
  }) {
    const existing = await db.hccallPromotion.findUnique({ where: { id } });
    if (!existing) throw new Error('Dinamização não encontrada.');

    // Increment version if commission or value or service changed
    const isValueChanged =
      (data.suggestedCommissionCents !== undefined && data.suggestedCommissionCents !== existing.suggestedCommissionCents) ||
      (data.promoValueCents !== undefined && data.promoValueCents !== existing.promoValueCents) ||
      (data.serviceId !== undefined && data.serviceId !== existing.serviceId);

    const nextVersion = isValueChanged ? existing.version + 1 : existing.version;

    return db.hccallPromotion.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.serviceId !== undefined && { serviceId: data.serviceId }),
        ...(data.suggestedCommissionCents !== undefined && { suggestedCommissionCents: Math.round(data.suggestedCommissionCents) }),
        ...(data.promoValueCents !== undefined && { promoValueCents: data.promoValueCents ? Math.round(data.promoValueCents) : null }),
        ...(data.startsAt !== undefined && { startsAt: data.startsAt ? new Date(data.startsAt) : null }),
        ...(data.endsAt !== undefined && { endsAt: data.endsAt ? new Date(data.endsAt) : null }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.notes !== undefined && { notes: data.notes }),
        version: nextVersion
      }
    });
  }

  static async deletePromotion(db: any, tenantId: string, id: string) {
    return db.hccallPromotion.update({
      where: { id },
      data: { deletedAt: new Date(), active: false }
    });
  }

  // =========================================================================
  // ESTADOS DE VENDA
  // =========================================================================

  static async listSaleStatuses(db: any, tenantId: string) {
    await this.ensureDefaults(db, tenantId);
    return db.hccallSaleStatus.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' }
    });
  }

  static async createSaleStatus(db: any, tenantId: string, data: {
    key: string;
    label: string;
    color?: string;
    sortOrder?: number;
    isTerminal?: boolean;
    commissionState?: 'FORECAST' | 'CONFIRMED' | 'PAID' | 'VOID';
  }) {
    return db.hccallSaleStatus.create({
      data: {
        tenantId,
        key: data.key.toLowerCase().trim(),
        label: data.label.trim(),
        color: data.color || '#6b7280',
        sortOrder: data.sortOrder ?? 100,
        isTerminal: data.isTerminal ?? false,
        commissionState: data.commissionState || 'FORECAST',
        isSystem: false
      }
    });
  }

  static async updateSaleStatus(db: any, tenantId: string, id: string, data: {
    label?: string;
    color?: string;
    sortOrder?: number;
    isTerminal?: boolean;
    commissionState?: 'FORECAST' | 'CONFIRMED' | 'PAID' | 'VOID';
  }) {
    return db.hccallSaleStatus.update({
      where: { id },
      data: {
        ...(data.label && { label: data.label.trim() }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.isTerminal !== undefined && { isTerminal: data.isTerminal }),
        ...(data.commissionState && { commissionState: data.commissionState })
      }
    });
  }

  static async deleteSaleStatus(db: any, tenantId: string, id: string) {
    const existing = await db.hccallSaleStatus.findUnique({ where: { id } });
    if (existing?.isSystem) {
      throw new Error('Não é permitido apagar um estado de sistema.');
    }
    return db.hccallSaleStatus.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // SEED DE VALORES INICIAIS POR TENANT
  // =========================================================================

  static async ensureDefaults(db: any, tenantId: string) {
    const countStatuses = await db.hccallSaleStatus.count({ where: { tenantId } });
    if (countStatuses === 0) {
      const defaultStatuses = [
        { key: 'registada', label: 'Registada', color: '#3b82f6', sortOrder: 10, isTerminal: false, commissionState: 'FORECAST', isSystem: true },
        { key: 'pendente', label: 'Pendente', color: '#f59e0b', sortOrder: 20, isTerminal: false, commissionState: 'FORECAST', isSystem: true },
        { key: 'em_validacao', label: 'Em Validação', color: '#8b5cf6', sortOrder: 30, isTerminal: false, commissionState: 'FORECAST', isSystem: true },
        { key: 'ativada', label: 'Ativada', color: '#10b981', sortOrder: 40, isTerminal: false, commissionState: 'CONFIRMED', isSystem: true },
        { key: 'comissionada', label: 'Comissionada', color: '#059669', sortOrder: 50, isTerminal: false, commissionState: 'CONFIRMED', isSystem: true },
        { key: 'paga', label: 'Paga', color: '#047857', sortOrder: 60, isTerminal: true, commissionState: 'PAID', isSystem: true },
        { key: 'cancelada', label: 'Cancelada', color: '#6b7280', sortOrder: 70, isTerminal: true, commissionState: 'VOID', isSystem: true },
        { key: 'rejeitada', label: 'Rejeitada', color: '#ef4444', sortOrder: 80, isTerminal: true, commissionState: 'VOID', isSystem: true }
      ];

      for (const st of defaultStatuses) {
        await db.hccallSaleStatus.create({
          data: {
            tenantId,
            ...st
          }
        }).catch(() => {});
      }
    }

    const countServices = await db.hccallService.count({ where: { tenantId } });
    if (countServices === 0) {
      const defaultServices = [
        { name: 'Móvel Pós-Pago', color: '#2563eb', sortOrder: 10 },
        { name: 'MEO Fibra / TV+NET+VOZ', color: '#0d419f', sortOrder: 20 },
        { name: 'Equipamento / Smartphone', color: '#7c3aed', sortOrder: 30 },
        { name: 'Aditivo Dados / Serviços', color: '#059669', sortOrder: 40 }
      ];

      for (const s of defaultServices) {
        await db.hccallService.create({
          data: {
            tenantId,
            ownerUserId: 'system',
            name: s.name,
            color: s.color,
            sortOrder: s.sortOrder,
            active: true
          }
        }).catch(() => {});
      }
    }
  }
}
