export class SellItemCostService {
  /**
   * Adds an extra cost to an item and atomically recalculates extraCostsCents & totalCostCents.
   */
  static async addCost(
    db: any,
    tenantId: string,
    itemId: string,
    data: {
      category: string; // TRANSPORT | RESTORATION | APPRAISAL | COMMISSION | TAX | OTHER
      description: string;
      amountCents: number;
      date?: string | Date;
      supplierCompanyId?: string;
    }
  ) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    const amountCents = Math.round(data.amountCents);
    const date = data.date ? new Date(data.date) : new Date();

    // 1. Create Cost record
    const cost = await db.sellItemCost.create({
      data: {
        tenantId,
        itemId,
        category: data.category || 'OTHER',
        description: data.description.trim(),
        amountCents,
        date,
        supplierCompanyId: data.supplierCompanyId || null
      }
    });

    // 2. Materialize total costs on SellItem
    await this.recalculateItemCosts(db, tenantId, itemId);

    return cost;
  }

  static async listCosts(db: any, tenantId: string, itemId: string) {
    return db.sellItemCost.findMany({
      where: { tenantId, itemId, deletedAt: null },
      orderBy: { date: 'desc' }
    });
  }

  static async deleteCost(db: any, tenantId: string, costId: string) {
    const cost = await db.sellItemCost.findUnique({ where: { id: costId } });
    if (!cost || cost.tenantId !== tenantId) throw new Error('Custo não encontrado.');

    await db.sellItemCost.update({
      where: { id: costId },
      data: { deletedAt: new Date() }
    });

    await this.recalculateItemCosts(db, tenantId, cost.itemId);
    return { success: true };
  }

  /**
   * Recalculates and materializes extraCostsCents and totalCostCents in a single query.
   */
  static async recalculateItemCosts(db: any, tenantId: string, itemId: string) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item) return;

    const costs = await db.sellItemCost.findMany({
      where: { tenantId, itemId, deletedAt: null }
    });

    const extraCostsCents = costs.reduce((acc: number, c: any) => acc + c.amountCents, 0);
    const totalCostCents = item.acquisitionCents + extraCostsCents;

    await db.sellItem.update({
      where: { id: itemId },
      data: {
        extraCostsCents,
        totalCostCents
      }
    });
  }
}
