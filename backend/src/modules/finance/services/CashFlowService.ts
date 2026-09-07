import { prisma } from '../../../database/prisma/client';

export class CashFlowService {
  static async calculateBalances(tenantId: string) {
    const [rev, exp] = await Promise.all([
      prisma.financialTransaction.aggregate({
        where: { tenantId, type: 'REVENUE', status: 'APPROVED' },
        _sum: { amount: true }
      }),
      prisma.financialTransaction.aggregate({
        where: { tenantId, type: 'EXPENSE', status: 'APPROVED' },
        _sum: { amount: true }
      })
    ]);

    const totalInflows = rev._sum?.amount || 0;
    const totalOutflows = exp._sum?.amount || 0;
    return {
      totalInflows,
      totalOutflows,
      netCash: totalInflows - totalOutflows
    };
  }
}
