export class HccallDynamizationService {
  static async listDynamizations(db: any, tenantId: string, userId: string) {
    let dyns = await db.hccallDynamization.findMany({
      where: { tenantId, userId, deletedAt: null },
      include: {
        tiers: { orderBy: { minQuantity: 'asc' } },
        bonuses: { orderBy: { thresholdCount: 'asc' } },
        rules: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (dyns.length === 0) {
      // Criar dinamização padrão para o utilizador
      const dyn = await db.hccallDynamization.create({
        data: {
          tenantId,
          userId,
          name: 'Dinamização Geral de Vendas',
          description: 'Regra de escalões progressivos com bónus de superação',
          tierMode: 'RETROACTIVE',
          startsAt: new Date(),
          active: true,
          tiers: {
            create: [
              { tenantId, minQuantity: 1, maxQuantity: 10, unitAmountCents: 800 },
              { tenantId, minQuantity: 11, maxQuantity: 20, unitAmountCents: 1000 },
              { tenantId, minQuantity: 21, maxQuantity: 30, unitAmountCents: 1200 },
              { tenantId, minQuantity: 31, maxQuantity: null, unitAmountCents: 1500 }
            ]
          },
          bonuses: {
            create: [
              { tenantId, thresholdCount: 20, bonusAmountCents: 5000 },
              { tenantId, thresholdCount: 30, bonusAmountCents: 10000 },
              { tenantId, thresholdCount: 40, bonusAmountCents: 20000 }
            ]
          }
        },
        include: {
          tiers: { orderBy: { minQuantity: 'asc' } },
          bonuses: { orderBy: { thresholdCount: 'asc' } },
          rules: true
        }
      });
      return [dyn];
    }

    return dyns;
  }

  static async getDynamization(db: any, tenantId: string, userId: string, id: string) {
    return db.hccallDynamization.findFirst({
      where: { id, tenantId, userId, deletedAt: null },
      include: {
        tiers: { orderBy: { minQuantity: 'asc' } },
        bonuses: { orderBy: { thresholdCount: 'asc' } },
        rules: true
      }
    });
  }

  static async createDynamization(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      name: string;
      description?: string;
      tierMode?: string;
      startsAt: string | Date;
      endsAt?: string | Date | null;
      tiers?: { minQuantity: number; maxQuantity: number | null; unitAmountCents: number }[];
      bonuses?: { thresholdCount: number; bonusAmountCents: number }[];
    }
  ) {
    return db.hccallDynamization.create({
      data: {
        tenantId,
        userId,
        name: data.name,
        description: data.description,
        tierMode: data.tierMode || 'RETROACTIVE',
        startsAt: new Date(data.startsAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        active: true,
        tiers: {
          create: (data.tiers || []).map(t => ({
            tenantId,
            minQuantity: t.minQuantity,
            maxQuantity: t.maxQuantity,
            unitAmountCents: t.unitAmountCents
          }))
        },
        bonuses: {
          create: (data.bonuses || []).map(b => ({
            tenantId,
            thresholdCount: b.thresholdCount,
            bonusAmountCents: b.bonusAmountCents
          }))
        }
      },
      include: {
        tiers: { orderBy: { minQuantity: 'asc' } },
        bonuses: { orderBy: { thresholdCount: 'asc' } }
      }
    });
  }

  static async updateDynamization(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      tierMode?: string;
      startsAt?: string | Date;
      endsAt?: string | Date | null;
      active?: boolean;
      tiers?: { minQuantity: number; maxQuantity: number | null; unitAmountCents: number }[];
      bonuses?: { thresholdCount: number; bonusAmountCents: number }[];
    }
  ) {
    // A alteração incrementa a versão da dinamização sem afetar retroativamente vendas passadas
    return db.$transaction(async (tx: any) => {
      const existing = await tx.hccallDynamization.findUnique({ where: { id } });
      if (!existing) throw new Error('Dinamização não encontrada');

      const nextVersion = existing.version + 1;

      if (data.tiers) {
        await tx.hccallDynamizationTier.deleteMany({ where: { dynamizationId: id } });
      }
      if (data.bonuses) {
        await tx.hccallDynamizationBonus.deleteMany({ where: { dynamizationId: id } });
      }

      return tx.hccallDynamization.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          tierMode: data.tierMode,
          startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
          endsAt: data.endsAt !== undefined ? (data.endsAt ? new Date(data.endsAt) : null) : undefined,
          active: data.active,
          version: nextVersion,
          tiers: data.tiers ? {
            create: data.tiers.map(t => ({
              tenantId,
              minQuantity: t.minQuantity,
              maxQuantity: t.maxQuantity,
              unitAmountCents: t.unitAmountCents
            }))
          } : undefined,
          bonuses: data.bonuses ? {
            create: data.bonuses.map(b => ({
              tenantId,
              thresholdCount: b.thresholdCount,
              bonusAmountCents: b.bonusAmountCents
            }))
          } : undefined
        },
        include: {
          tiers: { orderBy: { minQuantity: 'asc' } },
          bonuses: { orderBy: { thresholdCount: 'asc' } }
        }
      });
    });
  }

  /**
   * Arquiva uma dinamização (soft delete).
   *
   * NUNCA se apaga fisicamente: as comissões já calculadas referenciam a
   * dinamização que lhes deu origem. Apagá-la invalidaria o histórico de
   * comissões — precisamente o registo que dá ao vendedor o argumento factual
   * numa reclamação. Se existirem vendas associadas, a dinamização é arquivada
   * e deixa de estar disponível para novas vendas, mantendo o histórico intacto.
   */
  static async deleteDynamization(db: any, tenantId: string, userId: string, id: string) {
    const existing = await db.hccallDynamization.findFirst({
      where: { id, tenantId, userId, deletedAt: null }
    });
    if (!existing) return null;

    const linkedSales = await db.hccallSale.count({ where: { tenantId, dynamizationId: id, deletedAt: null } });

    const archived = await db.hccallDynamization.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return { ...archived, archived: true, linkedSales };
  }
}
