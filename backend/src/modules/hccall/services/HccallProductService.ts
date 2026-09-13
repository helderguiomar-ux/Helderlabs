export class HccallProductService {
  static async listProducts(db: any, tenantId: string, userId: string) {
    let prods = await db.hccallProduct.findMany({
      where: { tenantId, userId, deletedAt: null },
      orderBy: { sortOrder: 'asc' }
    });

    if (prods.length === 0) {
      // Inicializar catálogo base de demonstração
      const defaults = [
        { name: 'Fibra 1Gbps', sku: 'FIBRA_1G', category: 'Telecomunicações', baseValueCents: 3500 },
        { name: 'Móvel Ilimitado', sku: 'MOV_UNL', category: 'Telecomunicações', baseValueCents: 1500 },
        { name: 'Seguro Saúde Familiar', sku: 'SEG_SAUDE', category: 'Seguros', baseValueCents: 4500 },
        { name: 'Eletricidade + Gás', sku: 'ENERGIA_DUO', category: 'Energia', baseValueCents: 2500 },
        { name: 'Alarme Residencial', sku: 'ALARM_RES', category: 'Segurança', baseValueCents: 4000 }
      ];

      for (const d of defaults) {
        await db.hccallProduct.create({
          data: {
            tenantId,
            userId,
            name: d.name,
            sku: d.sku,
            category: d.category,
            baseValueCents: d.baseValueCents,
            active: true
          }
        });
      }

      prods = await db.hccallProduct.findMany({
        where: { tenantId, userId, deletedAt: null },
        orderBy: { sortOrder: 'asc' }
      });
    }

    // Associar objetivo mensal do mês corrente a cada produto
    const now = new Date();
    const activeObjectives = await db.hccallObjective.findMany({
      where: {
        tenantId,
        userId,
        periodStart: { lte: now },
        periodEnd: { gte: now },
        deletedAt: null
      }
    });

    const objMap = new Map<string, number>();
    for (const obj of activeObjectives) {
      if (obj.productId) {
        objMap.set(obj.productId, obj.targetValue);
      }
    }

    return prods.map((p: any) => ({
      ...p,
      monthlyTarget: objMap.get(p.id) || 0
    }));
  }

  static async createProduct(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      name: string;
      sku?: string;
      category?: string;
      baseValueCents?: number;
      defaultCommissionCents?: number;
      sortOrder?: number;
      monthlyTarget?: number;
    }
  ) {
    const prod = await db.hccallProduct.create({
      data: {
        tenantId,
        userId,
        name: data.name,
        sku: data.sku,
        category: data.category || 'Geral',
        baseValueCents: data.baseValueCents ?? 0,
        defaultCommissionCents: data.defaultCommissionCents ?? 0,
        sortOrder: data.sortOrder ?? 100,
        active: true
      }
    });

    if (data.monthlyTarget !== undefined && data.monthlyTarget > 0) {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      await db.hccallObjective.create({
        data: {
          tenantId,
          userId,
          productId: prod.id,
          name: `Objetivo ${prod.name}`,
          type: 'PRODUCT_COUNT',
          targetValue: data.monthlyTarget,
          unit: 'vendas',
          periodStart,
          periodEnd,
          currentValue: 0
        }
      });
    }

    return { ...prod, monthlyTarget: data.monthlyTarget || 0 };
  }

  static async updateProduct(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    data: {
      name?: string;
      sku?: string;
      category?: string;
      baseValueCents?: number;
      defaultCommissionCents?: number;
      active?: boolean;
      sortOrder?: number;
      monthlyTarget?: number;
    }
  ) {
    const updated = await db.hccallProduct.update({
      where: { id },
      data: {
        name: data.name,
        sku: data.sku,
        category: data.category,
        baseValueCents: data.baseValueCents,
        defaultCommissionCents: data.defaultCommissionCents,
        active: data.active,
        sortOrder: data.sortOrder
      }
    });

    if (data.monthlyTarget !== undefined) {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const existingObj = await db.hccallObjective.findFirst({
        where: {
          tenantId,
          userId,
          productId: id,
          periodStart: { lte: now },
          periodEnd: { gte: now },
          deletedAt: null
        }
      });

      if (existingObj) {
        if (data.monthlyTarget > 0) {
          await db.hccallObjective.update({
            where: { id: existingObj.id },
            data: { targetValue: data.monthlyTarget, name: `Objetivo ${updated.name}` }
          });
        } else {
          await db.hccallObjective.update({
            where: { id: existingObj.id },
            data: { deletedAt: new Date() }
          });
        }
      } else if (data.monthlyTarget > 0) {
        await db.hccallObjective.create({
          data: {
            tenantId,
            userId,
            productId: id,
            name: `Objetivo ${updated.name}`,
            type: 'PRODUCT_COUNT',
            targetValue: data.monthlyTarget,
            unit: 'vendas',
            periodStart,
            periodEnd,
            currentValue: 0
          }
        });
      }
    }

    return { ...updated, monthlyTarget: data.monthlyTarget ?? 0 };
  }

  static async deleteProduct(db: any, tenantId: string, userId: string, id: string) {
    return db.hccallProduct.update({
      where: { id },
      data: { deletedAt: new Date(), active: false }
    });
  }
}
