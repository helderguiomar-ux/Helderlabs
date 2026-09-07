import { prisma } from '../../../database/prisma/client';

export class BudgetService {
  static async getActiveBudgetStatus(tenantId: string) {
    const now = new Date();
    return prisma.budget.findFirst({
      where: {
        tenantId,
        status: 'ACTIVE',
        startDate: { lte: now },
        endDate: { gte: now }
      },
      include: { budgetItems: true }
    });
  }
}
