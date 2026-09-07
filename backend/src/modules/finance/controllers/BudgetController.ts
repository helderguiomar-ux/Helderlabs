import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { CreateBudgetSchema } from '../middleware/financialValidation.middleware';

export class BudgetController {
  /**
   * GET /api/finance/budgets
   * Listar todos os orçamentos
   */
  static async listBudgets(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { status, year } = req.query as any;

    const where: any = { tenantId };
    if (status) where.status = status;
    if (year) where.year = parseInt(String(year), 10);

    const budgets = await prisma.budget.findMany({
      where,
      include: { budgetItems: true },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send({
      success: true,
      budgets: budgets.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        status: b.status,
        year: b.year,
        month: b.month,
        startDate: b.startDate,
        endDate: b.endDate,
        alertThreshold: b.alertThreshold,
        period: b.month ? `${b.year}-${String(b.month).padStart(2, '0')}` : b.year.toString(),
        totalBudgeted: b.budgetItems.reduce((sum, item) => sum + item.budgetAmount, 0),
        itemsCount: b.budgetItems.length,
        items: b.budgetItems,
        approvedAt: b.approvedAt
      }))
    });
  }

  /**
   * POST /api/finance/budgets
   * Criar novo orçamento
   */
  static async createBudget(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const body = CreateBudgetSchema.parse(req.body);

    const budget = await prisma.budget.create({
      data: {
        tenantId,
        name: body.name,
        description: body.description || undefined,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        year: body.year,
        month: body.month || undefined,
        status: 'DRAFT',
        alertThreshold: body.alertThreshold,
        budgetItems: {
          create: body.budgetItems.map(item => ({
            category: item.category as any,
            budgetAmount: item.budgetAmount
          }))
        }
      },
      include: { budgetItems: true }
    });

    return reply.status(201).send({
      success: true,
      budget
    });
  }

  /**
   * GET /api/finance/budgets/:id/analysis
   * Análise de um orçamento vs realizado
   */
  static async analyzeBudget(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const budget = await prisma.budget.findFirst({
      where: { id, tenantId },
      include: { budgetItems: true }
    });

    if (!budget) {
      return reply.status(404).send({ error: 'BUDGET_NOT_FOUND', message: 'Orçamento não encontrado' });
    }

    // Calcular gasto real por categoria
    const actualExpenses = await prisma.financialTransaction.groupBy({
      by: ['category'],
      where: {
        tenantId,
        type: 'EXPENSE',
        status: 'APPROVED',
        date: { gte: budget.startDate, lte: budget.endDate }
      },
      _sum: { amount: true }
    });

    const analysis = budget.budgetItems.map(item => {
      const match = actualExpenses.find(e => e.category === item.category);
      const actual = match?._sum?.amount || 0;
      const variance = item.budgetAmount - actual;
      const percentageUsed = item.budgetAmount > 0 ? (actual / item.budgetAmount) * 100 : 0;
      const isAlert = percentageUsed >= budget.alertThreshold;

      return {
        category: item.category,
        budgeted: item.budgetAmount,
        actual,
        variance,
        percentageUsed: Number(percentageUsed.toFixed(2)),
        isAlert
      };
    });

    const totalBudgeted = budget.budgetItems.reduce((sum, item) => sum + item.budgetAmount, 0);
    const totalActual = analysis.reduce((sum, item) => sum + item.actual, 0);

    return reply.send({
      success: true,
      budget: {
        id: budget.id,
        name: budget.name,
        period: budget.month ? `${budget.year}-${String(budget.month).padStart(2, '0')}` : budget.year.toString(),
        totalBudgeted,
        totalActual,
        totalVariance: totalBudgeted - totalActual,
        percentageUsed: totalBudgeted > 0 ? Number(((totalActual / totalBudgeted) * 100).toFixed(2)) : 0,
        items: analysis
      }
    });
  }

  /**
   * POST /api/finance/budgets/:id/approve
   * Aprovar um orçamento
   */
  static async approveBudget(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const existing = await prisma.budget.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: 'BUDGET_NOT_FOUND' });
    }

    const budget = await prisma.budget.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        approvedBy: user?.sub,
        approvedAt: new Date()
      }
    });

    return reply.send({ success: true, budget });
  }
}
