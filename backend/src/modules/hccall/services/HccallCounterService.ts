export class HccallCounterService {
  /**
   * Generates next sequential code for sales atomically per tenant/year.
   */
  static async nextSaleCode(db: any, tenantId: string, year: number = new Date().getFullYear()): Promise<string> {
    const scope = 'sale';

    const counter = await db.hccallCounter.upsert({
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

    const padded = String(counter.value).padStart(4, '0');
    return `VND-${year}-${padded}`;
  }

  static async getNextSaleCode(db: any, tenantId: string): Promise<string> {
    return this.nextSaleCode(db, tenantId, new Date().getFullYear());
  }
}
