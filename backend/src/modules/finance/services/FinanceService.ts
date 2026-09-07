import { prisma } from '../../../database/prisma/client';

export class FinanceService {
  static async getSummary(tenantId: string) {
    const last12Months = new Date();
    last12Months.setMonth(last12Months.getMonth() - 12);

    const [revenues, expenses] = await Promise.all([
      prisma.financialTransaction.aggregate({
        where: { tenantId, type: 'REVENUE', status: 'APPROVED', date: { gte: last12Months } },
        _sum: { amount: true }
      }),
      prisma.financialTransaction.aggregate({
        where: { tenantId, type: 'EXPENSE', status: 'APPROVED', date: { gte: last12Months } },
        _sum: { amount: true }
      })
    ]);

    const totalRevenue = revenues._sum?.amount || 0;
    const totalExpense = expenses._sum?.amount || 0;
    const profit = totalRevenue - totalExpense;

    return {
      totalRevenue,
      totalExpense,
      profit,
      profitMargin: totalRevenue > 0 ? `${((profit / totalRevenue) * 100).toFixed(2)}%` : '0%'
    };
  }
}
