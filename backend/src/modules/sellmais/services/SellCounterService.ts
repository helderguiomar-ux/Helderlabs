export class SellCounterService {
  /**
   * Generates next sequential atomic code per tenant/year (e.g. HL-2026-00001, AUC-2026-00001).
   */
  static async getNextCode(db: any, tenantId: string, scope: 'item' | 'auction' = 'item'): Promise<string> {
    const year = new Date().getFullYear();

    const counter = await db.sellCounter.upsert({
      where: {
        tenantId_year_scope: {
          tenantId,
          year,
          scope
        }
      },
      update: {
        value: {
          increment: 1
        }
      },
      create: {
        tenantId,
        year,
        scope,
        value: 1
      }
    });

    const prefix = scope === 'auction' ? 'AUC' : 'ART';
    const padded = String(counter.value).padStart(5, '0');
    return `${prefix}-${year}-${padded}`;
  }
}
