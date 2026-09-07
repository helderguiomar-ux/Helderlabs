import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';

export class FinanceDashboardController {
  /**
   * GET /api/finance/dashboard
   * Dashboard completo com métricas e gráficos
   */
  static async getDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;

    // Últimos 12 meses
    const last12Months = new Date();
    last12Months.setMonth(last12Months.getMonth() - 12);

    // Resumo geral (considera todas as transações exceto REJECTED)
    const validStatuses: any = { not: 'REJECTED' };

    const revenues = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'REVENUE',
        status: validStatuses,
        date: { gte: last12Months }
      },
      _sum: { amount: true }
    });

    const expenses = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'EXPENSE',
        status: validStatuses,
        date: { gte: last12Months }
      },
      _sum: { amount: true }
    });

    const totalRevenue = Number((revenues._sum?.amount || 0).toFixed(2));
    const totalExpense = Number((expenses._sum?.amount || 0).toFixed(2));
    const profit = Number((totalRevenue - totalExpense).toFixed(2));
    const margin = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(1)) : 0;

    // Gráfico de Receitas vs Despesas (últimos 12 meses)
    const monthlyData = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth();

      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const monthRevenues = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'REVENUE',
          status: validStatuses,
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { amount: true }
      });

      const monthExpenses = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'EXPENSE',
          status: validStatuses,
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { amount: true }
      });

      const mRev = Number((monthRevenues._sum?.amount || 0).toFixed(2));
      const mExp = Number((monthExpenses._sum?.amount || 0).toFixed(2));
      const monthLabel = `${year}-${String(month + 1).padStart(2, '0')}`;

      monthlyData.push({
        month: monthLabel,
        revenue: mRev,
        expense: mExp,
        expenses: mExp
      });
    }

    // Distribuição de despesas por categoria
    const expensesByCategory = await prisma.financialTransaction.groupBy({
      by: ['category'],
      where: {
        tenantId,
        type: 'EXPENSE',
        status: validStatuses,
        date: { gte: last12Months }
      },
      _sum: { amount: true }
    });

    const categoryData = expensesByCategory
      .filter(c => c.category !== null)
      .map(c => ({
        category: c.category || 'Geral',
        amount: Number((c._sum?.amount || 0).toFixed(2))
      }))
      .sort((a, b) => b.amount - a.amount);

    // Transações recentes
    const recentTransactions = await prisma.financialTransaction.findMany({
      where: { tenantId },
      take: 10,
      orderBy: { date: 'desc' }
    });

    // Orçamentos alertas
    const budgetAlerts: Array<{ budgetName: string; percentageUsed: string; severity: string }> = [];
    const activeBudgets = await prisma.budget.findMany({
      where: { tenantId, status: 'ACTIVE' },
      include: { budgetItems: true }
    });

    for (const budget of activeBudgets) {
      const actual = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'EXPENSE',
          status: validStatuses,
          date: { gte: budget.startDate, lte: budget.endDate }
        },
        _sum: { amount: true }
      });

      const totalBudgeted = budget.budgetItems.reduce((sum, item) => sum + item.budgetAmount, 0);
      const totalActual = actual._sum?.amount || 0;
      const percentageUsed = totalBudgeted > 0 ? (totalActual / totalBudgeted) * 100 : 0;

      if (percentageUsed >= budget.alertThreshold) {
        budgetAlerts.push({
          budgetName: budget.name,
          percentageUsed: percentageUsed.toFixed(2),
          severity: percentageUsed >= 100 ? 'critical' : 'warning'
        });
      }
    }

    const payload = {
      kpis: {
        totalRevenue,
        totalExpenses: totalExpense,
        netIncome: profit,
        netMarginPercent: margin,
        availableBalance: profit,
        budgetAlertsCount: budgetAlerts.length
      },
      summary: {
        totalRevenue,
        totalExpense,
        totalExpenses: totalExpense,
        profit,
        netIncome: profit,
        profitMargin: `${margin}%`,
        currency: 'EUR'
      },
      monthlyTrend: monthlyData,
      categoryBreakdown: categoryData,
      recentTransactions: recentTransactions.map(t => ({
        id: t.id,
        description: t.description,
        amount: t.amount,
        type: t.type,
        category: t.category,
        date: t.date,
        dueDate: t.dueDate,
        status: t.status
      })),
      budgetAlerts
    };

    return reply.send({
      success: true,
      data: payload,
      dashboard: payload,
      ...payload
    });
  }

  /**
   * GET /api/finance/dashboard/cashflow-projection
   * Projeção de fluxo de caixa
   */
  static async getCashFlowProjection(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { months = 6, scenario = 'BASE' } = req.query as any;

    const projections = [];
    let openingBalance = 0;

    // Obter saldo inicial (últimas reconciliações ou saldo inicial)
    const lastReconciliation = await prisma.bankReconciliation.findFirst({
      where: { tenantId },
      orderBy: { statementDate: 'desc' },
      take: 1
    });

    if (lastReconciliation) {
      openingBalance = lastReconciliation.statementAmount;
    }

    const numMonths = parseInt(String(months), 10);
    for (let i = 0; i < numMonths; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);

      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

      const revenues = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'REVENUE',
          status: 'APPROVED',
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { amount: true }
      });

      const expenses = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'EXPENSE',
          status: 'APPROVED',
          date: { gte: monthStart, lte: monthEnd }
        },
        _sum: { amount: true }
      });

      let rawInflows = revenues._sum?.amount || 0;
      let rawOutflows = expenses._sum?.amount || 0;

      // Ajustes por cenário
      if (scenario === 'OPTIMISTIC') {
        rawInflows *= 1.15;
        rawOutflows *= 0.95;
      } else if (scenario === 'PESSIMISTIC') {
        rawInflows *= 0.85;
        rawOutflows *= 1.10;
      }

      const inflows = Number(rawInflows.toFixed(2));
      const outflows = Number(rawOutflows.toFixed(2));
      const closingBalance = Number((openingBalance + inflows - outflows).toFixed(2));

      projections.push({
        month: date.toLocaleDateString('pt-PT', { month: 'short', year: '2-digit' }),
        openingBalance: Number(openingBalance.toFixed(2)),
        inflows,
        outflows,
        closingBalance,
        scenario
      });

      openingBalance = closingBalance;
    }

    return reply.send({
      success: true,
      cashFlow: projections
    });
  }
}
