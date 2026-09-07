import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { CreateBudgetSchema } from '../middleware/financialValidation.middleware';

function sanitizeExpenseCategory(cat?: string | null): any {
  if (!cat) return 'MISCELLANEOUS';
  const upper = String(cat).trim().toUpperCase();
  const valid = [
    'SALARY', 'RENT', 'UTILITIES', 'OFFICE_SUPPLIES', 'TRAVEL',
    'PROFESSIONAL_SERVICES', 'MAINTENANCE', 'MARKETING', 'INSURANCE',
    'TAXES', 'DEPRECIATION', 'INTEREST', 'MISCELLANEOUS'
  ];
  if (valid.includes(upper)) return upper;
  if (upper.includes('SALAR') || upper.includes('RH')) return 'SALARY';
  if (upper.includes('RENT') || upper.includes('RENDA') || upper.includes('ESCRIT')) return 'RENT';
  if (upper.includes('UTIL') || upper.includes('AGUA') || upper.includes('LUZ') || upper.includes('TEL')) return 'UTILITIES';
  if (upper.includes('SUPPL') || upper.includes('OFFICE') || upper.includes('HARDWARE')) return 'OFFICE_SUPPLIES';
  if (upper.includes('TRAVEL') || upper.includes('VIAGEM') || upper.includes('DESLOC')) return 'TRAVEL';
  if (upper.includes('PROFESSIONAL') || upper.includes('SOFT') || upper.includes('CONSULT')) return 'PROFESSIONAL_SERVICES';
  if (upper.includes('MAINT') || upper.includes('MANUT')) return 'MAINTENANCE';
  if (upper.includes('MARKET') || upper.includes('PUB')) return 'MARKETING';
  if (upper.includes('INSUR') || upper.includes('SEGUR')) return 'INSURANCE';
  if (upper.includes('TAX') || upper.includes('IMP')) return 'TAXES';
  return 'MISCELLANEOUS';
}

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

    const formatted = await Promise.all(budgets.map(async b => {
      const actual = await prisma.financialTransaction.aggregate({
        where: {
          tenantId,
          type: 'EXPENSE',
          status: { not: 'REJECTED' },
          date: { gte: b.startDate, lte: b.endDate }
        },
        _sum: { amount: true }
      });

      const totalBudgeted = b.budgetItems.reduce((sum, item) => sum + item.budgetAmount, 0) || 0;
      const spent = actual._sum?.amount || 0;
      const primaryCategory = b.budgetItems[0]?.category || 'Geral';

      return {
        id: b.id,
        name: b.name,
        description: b.description,
        status: b.status,
        year: b.year,
        month: b.month,
        startDate: b.startDate,
        endDate: b.endDate,
        alertThreshold: b.alertThreshold,
        category: primaryCategory,
        allocatedAmount: totalBudgeted,
        spentAmount: spent,
        totalBudgeted,
        totalActual: spent,
        period: b.month ? `${b.year}-${String(b.month).padStart(2, '0')}` : (b.year ? b.year.toString() : 'MENSAL'),
        itemsCount: b.budgetItems.length,
        items: b.budgetItems,
        approvedAt: b.approvedAt
      };
    }));

    return reply.send({
      success: true,
      data: formatted,
      budgets: formatted
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

    const sDate = new Date(body.startDate);
    const eDate = new Date(body.endDate);
    const yr = body.year || sDate.getFullYear();

    let items = body.budgetItems || [];
    if (items.length === 0 && body.allocatedAmount) {
      items = [{
        category: sanitizeExpenseCategory(body.category),
        budgetAmount: body.allocatedAmount
      }];
    }
    if (items.length === 0) {
      items = [{
        category: 'MISCELLANEOUS',
        budgetAmount: 1000
      }];
    }

    const budget = await prisma.budget.create({
      data: {
        tenantId,
        name: body.name,
        description: body.description || undefined,
        startDate: isNaN(sDate.getTime()) ? new Date() : sDate,
        endDate: isNaN(eDate.getTime()) ? new Date() : eDate,
        year: yr,
        month: body.month || undefined,
        status: 'ACTIVE',
        alertThreshold: body.alertThreshold || 90,
        budgetItems: {
          create: items.map(item => ({
            category: sanitizeExpenseCategory(item.category),
            budgetAmount: item.budgetAmount
          }))
        }
      },
      include: { budgetItems: true }
    });

    return reply.status(201).send({
      success: true,
      data: budget,
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
