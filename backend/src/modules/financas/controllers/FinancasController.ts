import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { RecurrenceService } from '../services/RecurrenceService';
import { seedFinancas } from '../services/seedFinancas';

// Validation Schemas
const CategorySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  kind: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional()
});

const TransactionSchema = z.object({
  description: z.string().min(1, 'Descrição é obrigatória'),
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: z.number().int().min(1, 'Valor em cêntimos deve ser positivo'),
  dueDate: z.string().or(z.date()),
  paidDate: z.string().or(z.date()).optional().nullable(),
  status: z.enum(['PLANNED', 'PAID']).default('PLANNED'),
  categoryId: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const RecurringRuleSchema = z.object({
  description: z.string().min(1, 'Descrição é obrigatória'),
  kind: z.enum(['INCOME', 'EXPENSE']),
  amountCents: z.number().int().min(1, 'Valor deve ser positivo'),
  categoryId: z.string().optional().nullable(),
  freq: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().min(1).default(1),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()).optional().nullable()
});

const LoanSchema = z.object({
  counterparty: z.string().min(1, 'Nome da contraparte é obrigatório'),
  direction: z.enum(['LENT', 'BORROWED']),
  principalCents: z.number().int().min(1, 'Valor principal deve ser positivo'),
  loanDate: z.string().or(z.date()),
  dueDate: z.string().or(z.date()).optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const LoanPaymentSchema = z.object({
  amountCents: z.number().int().min(1, 'Valor do pagamento deve ser positivo'),
  date: z.string().or(z.date()),
  notes: z.string().optional().nullable()
});

const BudgetSchema = z.object({
  categoryId: z.string().min(1, 'Categoria é obrigatória'),
  period: z.string().min(4, 'Período ex: 2026-09'),
  limitCents: z.number().int().min(0)
});

export class FinancasController {

  /** GET /api/financas/categories */
  static async listCategories(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const count = await db.financeCategory.count({ where: { archivedAt: null } });
    if (count === 0) {
      await seedFinancas(user.tenantId);
    }

    const categories = await db.financeCategory.findMany({
      where: { archivedAt: null },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }]
    });

    return reply.send({ success: true, categories });
  }

  /** POST /api/financas/categories */
  static async createCategory(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CategorySchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const category = await db.financeCategory.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        kind: body.kind,
        color: body.color || (body.kind === 'INCOME' ? '#10b981' : '#ef4444'),
        icon: body.icon || 'tag'
      }
    });

    return reply.status(201).send({ success: true, category });
  }

  /** GET /api/financas/transactions */
  static async listTransactions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as {
      kind?: string;
      status?: string;
      categoryId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    };
    const db = forTenant(user.tenantId);

    const where: any = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) {
      where.description = { contains: query.search, mode: 'insensitive' };
    }
    if (query.startDate || query.endDate) {
      where.dueDate = {};
      if (query.startDate) where.dueDate.gte = new Date(query.startDate);
      if (query.endDate) where.dueDate.lte = new Date(query.endDate);
    }

    const transactions = await db.financeTransaction.findMany({
      where,
      include: { category: true },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }]
    });

    return reply.send({ success: true, transactions });
  }

  /** POST /api/financas/transactions */
  static async createTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = TransactionSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const dueDate = new Date(body.dueDate);
    const paidDate = body.paidDate ? new Date(body.paidDate) : (body.status === 'PAID' ? new Date() : null);

    const transaction = await db.financeTransaction.create({
      data: {
        tenantId: user.tenantId,
        description: body.description,
        kind: body.kind,
        amountCents: body.amountCents,
        dueDate,
        paidDate,
        status: body.status,
        categoryId: body.categoryId || null,
        notes: body.notes || null
      },
      include: { category: true }
    });

    return reply.status(201).send({ success: true, transaction });
  }

  /** PUT /api/financas/transactions/:id */
  static async updateTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = TransactionSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);

    const existing = await db.financeTransaction.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transação não encontrada.' });
    }

    const dueDate = body.dueDate ? new Date(body.dueDate) : existing.dueDate;
    const status = body.status || existing.status;
    const paidDate = body.paidDate !== undefined ? (body.paidDate ? new Date(body.paidDate) : null) : (status === 'PAID' ? existing.paidDate || new Date() : null);

    const updated = await db.financeTransaction.update({
      where: { id },
      data: {
        ...(body.description && { description: body.description }),
        ...(body.kind && { kind: body.kind }),
        ...(body.amountCents !== undefined && { amountCents: body.amountCents }),
        ...(body.dueDate && { dueDate }),
        paidDate,
        status,
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.notes !== undefined && { notes: body.notes }),
        overriddenAt: new Date()
      },
      include: { category: true }
    });

    return reply.send({ success: true, transaction: updated });
  }

  /** PATCH /api/financas/transactions/:id/pay */
  static async payTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({ isPaid: z.boolean().default(true), paidDate: z.string().optional() }).parse(req.body);
    const db = forTenant(user.tenantId);

    const existing = await db.financeTransaction.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transação não encontrada.' });
    }

    const status = body.isPaid ? 'PAID' : 'PLANNED';
    const paidDate = body.isPaid ? (body.paidDate ? new Date(body.paidDate) : new Date()) : null;

    const updated = await db.financeTransaction.update({
      where: { id },
      data: {
        paidDate,
        status
      },
      include: { category: true }
    });

    return reply.send({ success: true, transaction: updated });
  }

  /** DELETE /api/financas/transactions/:id */
  static async deleteTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.financeTransaction.delete({ where: { id } });
    return reply.send({ success: true, message: 'Transação eliminada.' });
  }

  /** GET /api/financas/recurring */
  static async listRecurringRules(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const rules = await db.recurringRule.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send({ success: true, rules });
  }

  /** POST /api/financas/recurring */
  static async createRecurringRule(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = RecurringRuleSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const rule = await db.recurringRule.create({
      data: {
        tenantId: user.tenantId,
        description: body.description,
        kind: body.kind,
        amountCents: body.amountCents,
        categoryId: body.categoryId || null,
        freq: body.freq,
        interval: body.interval,
        dayOfMonth: body.dayOfMonth || null,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : null
      },
      include: { category: true }
    });

    await RecurrenceService.materialize(user.tenantId, new Date(), db);

    return reply.status(201).send({ success: true, rule });
  }

  /** POST /api/financas/recurring/materialize */
  static async materializeRecurring(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = z.object({ targetDate: z.string().optional() }).parse(req.body || {});
    const db = forTenant(user.tenantId);

    const targetDate = body.targetDate ? new Date(body.targetDate) : new Date();
    const result = await RecurrenceService.materialize(user.tenantId, targetDate, db);

    return reply.send({ success: true, ...result });
  }

  /** GET /api/financas/loans */
  static async listLoans(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const loans = await db.loan.findMany({
      include: { payments: true },
      orderBy: { createdAt: 'desc' }
    });

    const loansWithStats = loans.map((l: any) => {
      const paidCents = l.payments.reduce((acc: number, p: any) => acc + p.amountCents, 0);
      const remainingCents = Math.max(0, l.principalCents - paidCents);
      return {
        ...l,
        paidCents,
        remainingCents
      };
    });

    return reply.send({ success: true, loans: loansWithStats });
  }

  /** POST /api/financas/loans */
  static async createLoan(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = LoanSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const loan = await db.loan.create({
      data: {
        tenantId: user.tenantId,
        counterparty: body.counterparty,
        direction: body.direction,
        principalCents: body.principalCents,
        loanDate: new Date(body.loanDate),
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
        status: 'OPEN'
      }
    });

    return reply.status(201).send({ success: true, loan });
  }

  /** POST /api/financas/loans/:id/payments */
  static async recordLoanPayment(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = LoanPaymentSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const loan = await db.loan.findUnique({
      where: { id },
      include: { payments: true }
    });
    if (!loan) {
      return reply.status(404).send({ error: 'LOAN_NOT_FOUND', message: 'Empréstimo não encontrado.' });
    }

    const payment = await db.loanPayment.create({
      data: {
        tenantId: user.tenantId,
        loanId: id,
        amountCents: body.amountCents,
        date: new Date(body.date),
        notes: body.notes || null
      }
    });

    const allPayments = [...loan.payments, payment];
    const totalPaid = allPayments.reduce((sum: number, p: any) => sum + p.amountCents, 0);

    let nextStatus = loan.status;
    if (totalPaid >= loan.principalCents) {
      nextStatus = 'SETTLED';
    } else if (totalPaid > 0) {
      nextStatus = 'PARTIAL';
    }

    await db.loan.update({
      where: { id },
      data: {
        status: nextStatus,
        settledDate: nextStatus === 'SETTLED' ? new Date() : null
      }
    });

    return reply.status(201).send({ success: true, payment, loanStatus: nextStatus });
  }

  /** GET /api/financas/budgets */
  static async listBudgets(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { period } = req.query as { period?: string };
    const db = forTenant(user.tenantId);

    const currentPeriod = period || new Date().toISOString().substring(0, 7);

    const budgets = await db.budget.findMany({
      include: { budgetItems: true },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send({ success: true, period: currentPeriod, budgets });
  }

  /** POST /api/financas/budgets */
  static async upsertBudget(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = req.body as any;
    const db = forTenant(user.tenantId);

    const year = body.year || new Date().getFullYear();
    const month = body.month || (body.period ? parseInt(body.period.split('-')[1], 10) : new Date().getMonth() + 1);

    const budget = await db.budget.create({
      data: {
        tenantId: user.tenantId,
        name: body.name || `Orçamento ${year}-${month}`,
        startDate: body.startDate ? new Date(body.startDate) : new Date(year, month - 1, 1),
        endDate: body.endDate ? new Date(body.endDate) : new Date(year, month, 0),
        year,
        month,
        status: 'ACTIVE',
        alertThreshold: body.alertThreshold || 90,
        budgetItems: {
          create: (body.budgetItems || [
            { category: body.category || 'MISCELLANEOUS', budgetAmount: (body.limitCents ? body.limitCents / 100 : body.budgetAmount) || 1000 }
          ]).map((item: any) => ({
            category: item.category || 'MISCELLANEOUS',
            budgetAmount: item.budgetAmount || 1000
          }))
        }
      },
      include: { budgetItems: true }
    });

    return reply.send({ success: true, budget });
  }

  /** GET /api/financas/dashboard */
  static async getDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    await RecurrenceService.materialize(user.tenantId, new Date(), db);

    const transactions = await db.financeTransaction.findMany({
      include: { category: true }
    });

    let totalIncomeCents = 0;
    let totalExpenseCents = 0;
    let pendingReceivablesCents = 0;
    let pendingPayablesCents = 0;

    const categoryMap: Record<string, { name: string; kind: string; totalCents: number; color: string }> = {};

    for (const t of transactions) {
      if (t.status === 'PAID') {
        if (t.kind === 'INCOME') totalIncomeCents += t.amountCents;
        else totalExpenseCents += t.amountCents;

        if (t.category) {
          const catId = t.category.id;
          if (!categoryMap[catId]) {
            categoryMap[catId] = {
              name: t.category.name,
              kind: t.category.kind,
              totalCents: 0,
              color: t.category.color || '#3b82f6'
            };
          }
          categoryMap[catId].totalCents += t.amountCents;
        }
      } else {
        if (t.kind === 'INCOME') pendingReceivablesCents += t.amountCents;
        else pendingPayablesCents += t.amountCents;
      }
    }

    const netBalanceCents = totalIncomeCents - totalExpenseCents;

    return reply.send({
      success: true,
      summary: {
        totalIncomeCents,
        totalExpenseCents,
        netBalanceCents,
        pendingReceivablesCents,
        pendingPayablesCents
      },
      categoriesBreakdown: Object.values(categoryMap)
    });
  }

  /** GET /api/financas/export */
  static async exportData(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { format } = req.query as { format?: string };
    const db = forTenant(user.tenantId);

    const transactions = await db.financeTransaction.findMany({
      include: { category: true },
      orderBy: { dueDate: 'desc' }
    });

    if (format === 'csv') {
      const headers = 'ID,Descrição,Tipo,Valor (EUR),Data Vencimento,Estado,Categoria\n';
      const rows = transactions.map((t: any) =>
        `"${t.id}","${t.description.replace(/"/g, '""')}","${t.kind}",${(t.amountCents / 100).toFixed(2)},"${t.dueDate.toISOString().substring(0, 10)}","${t.status}","${t.category?.name || ''}"`
      ).join('\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="export_financas.csv"');
      return reply.send(headers + rows);
    }

    return reply.send({ success: true, exportDate: new Date(), transactions });
  }

  /** DELETE /api/financas/gdpr/anonymize */
  static async anonymizeGdpr(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    await db.financeTransaction.updateMany({
      where: { tenantId: user.tenantId },
      data: { notes: 'ANONYMIZED_GDPR', description: 'Transação Anonimizada' }
    });

    await db.loan.updateMany({
      where: { tenantId: user.tenantId },
      data: { counterparty: 'Anonimizado RGPD', phone: null, email: null, notes: null }
    });

    return reply.send({ success: true, message: 'Dados financeiros anonimizados em conformidade com o RGPD.' });
  }
}
