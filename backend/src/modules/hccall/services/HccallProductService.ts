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

    return prods;
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
      sortOrder?: number;
    }
  ) {
    return db.hccallProduct.create({
      data: {
        tenantId,
        userId,
        name: data.name,
        sku: data.sku,
        category: data.category || 'Geral',
        baseValueCents: data.baseValueCents ?? 0,
        sortOrder: data.sortOrder ?? 100,
        active: true
      }
    });
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
      active?: boolean;
      sortOrder?: number;
    }
  ) {
    return db.hccallProduct.update({
      where: { id },
      data
    });
  }

  static async deleteProduct(db: any, tenantId: string, userId: string, id: string) {
    return db.hccallProduct.update({
      where: { id },
      data: { deletedAt: new Date(), active: false }
    });
  }
}
