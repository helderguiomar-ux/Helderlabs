import { prisma } from '../../../database/prisma/client';

export class HccallCounterService {
  /**
   * Generates next sequential code for sales (e.g., #00001, #00125) atomically per tenant/year.
   */
  static async getNextSaleCode(db: any, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const scope = 'sale';

    // Atomic increment or initialization
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

    const padded = String(counter.value).padStart(5, '0');
    return `#${padded}`;
  }
}
