import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { CreateTransactionSchema, UpdateTransactionSchema } from '../middleware/financialValidation.middleware';

function sanitizeExpenseCategory(cat?: string | null): any {
  if (!cat) return null;
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

function sanitizeStatus(status?: string | null): any {
  if (!status) return 'PAID';
  const upper = String(status).trim().toUpperCase();
  const valid = ['PENDING', 'APPROVED', 'REJECTED', 'RECONCILED', 'PLANNED', 'PAID'];
  return valid.includes(upper) ? upper : 'PAID';
}

export class FinanceController {
  /**
   * GET /api/finance/transactions
   * Listar todas as transações financeiras
   */
  static async listTransactions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { type, status, category, startDate, endDate, limit = 100, offset = 0 } = req.query as any;

    const where: any = { tenantId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (category) where.category = sanitizeExpenseCategory(category);
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const transactions = await prisma.financialTransaction.findMany({
      where,
      orderBy: { date: 'desc' },
      take: parseInt(String(limit), 10),
      skip: parseInt(String(offset), 10),
      include: { attachments: true }
    });

    const total = await prisma.financialTransaction.count({ where });
    const formatted = transactions.map(t => ({
      id: t.id,
      type: t.type,
      status: t.status,
      description: t.description,
      amount: t.amount,
      currency: t.currency,
      date: t.date,
      dueDate: t.dueDate,
      category: t.category,
      supplier: t.supplier,
      customer: t.customer,
      invoiceNumber: t.invoiceNumber,
      costCenter: t.costCenter,
      notes: t.notes,
      approvedAt: t.approvedAt,
      approvedBy: t.approvedBy,
      reconciliationStatus: t.reconciliationStatus,
      attachments: t.attachments ? t.attachments.length : 0
    }));

    return reply.send({
      success: true,
      data: formatted,
      transactions: formatted,
      pagination: { limit: parseInt(String(limit), 10), offset: parseInt(String(offset), 10), total }
    });
  }

  /**
   * POST /api/finance/transactions
   * Criar nova transação financeira
   */
  static async createTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const body = CreateTransactionSchema.parse(req.body);

    const txDate = body.date ? new Date(body.date) : new Date();
    const finalDate = isNaN(txDate.getTime()) ? new Date() : txDate;

    const transaction = await prisma.financialTransaction.create({
      data: {
        tenantId,
        type: body.type as any,
        status: sanitizeStatus(body.status),
        description: body.description,
        amount: body.amount,
        currency: body.currency || 'EUR',
        date: finalDate,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        category: sanitizeExpenseCategory(body.category),
        supplier: body.supplier || undefined,
        customer: body.customer || undefined,
        invoiceNumber: body.invoiceNumber || undefined,
        costCenter: body.costCenter || undefined,
        notes: body.notes || undefined,
        createdBy: user?.sub
      }
    });

    return reply.status(201).send({
      success: true,
      data: transaction,
      transaction
    });
  }

  /**
   * GET /api/finance/transactions/:id
   * Obter detalhes de uma transação
   */
  static async getTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const transaction = await prisma.financialTransaction.findFirst({
      where: { id, tenantId },
      include: { attachments: true }
    });

    if (!transaction) {
      return reply.status(404).send({
        error: 'TRANSACTION_NOT_FOUND',
        message: 'Transação não encontrada'
      });
    }

    return reply.send({ success: true, data: transaction, transaction });
  }

  /**
   * PATCH /api/finance/transactions/:id
   * Atualizar transação
   */
  static async updateTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;
    const body = UpdateTransactionSchema.parse(req.body);

    const existing = await prisma.financialTransaction.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transação não encontrada' });
    }

    const transaction = await prisma.financialTransaction.update({
      where: { id },
      data: {
        ...(body.type && { type: body.type as any }),
        ...(body.status && { status: sanitizeStatus(body.status) }),
        ...(body.description && { description: body.description }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.currency && { currency: body.currency }),
        ...(body.date && { date: new Date(body.date) }),
        ...(body.dueDate !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
        ...(body.category !== undefined && { category: sanitizeExpenseCategory(body.category) }),
        ...(body.supplier !== undefined && { supplier: body.supplier }),
        ...(body.customer !== undefined && { customer: body.customer }),
        ...(body.invoiceNumber !== undefined && { invoiceNumber: body.invoiceNumber }),
        ...(body.costCenter !== undefined && { costCenter: body.costCenter }),
        ...(body.notes !== undefined && { notes: body.notes })
      }
    });

    return reply.send({ success: true, data: transaction, transaction });
  }

  /**
   * PATCH /api/finance/transactions/:id/status
   * Atualizar estado da transação
   */
  static async updateStatus(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;
    const { status } = (req.body as any) || {};

    const existing = await prisma.financialTransaction.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transação não encontrada' });
    }

    const nextStatus = sanitizeStatus(status);
    const transaction = await prisma.financialTransaction.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'APPROVED' && { approvedBy: user?.sub, approvedAt: new Date() })
      }
    });

    return reply.send({ success: true, data: transaction, transaction });
  }

  /**
   * POST /api/finance/transactions/:id/approve
   * Aprovar uma transação pendente
   */
  static async approveTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const existing = await prisma.financialTransaction.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND' });
    }

    const transaction = await prisma.financialTransaction.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: user?.sub,
        approvedAt: new Date()
      }
    });

    return reply.send({ success: true, data: transaction, transaction });
  }

  /**
   * DELETE /api/finance/transactions/:id
   * Eliminar transação
   */
  static async deleteTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const transaction = await prisma.financialTransaction.findFirst({
      where: { id, tenantId }
    });

    if (!transaction) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND', message: 'Transação não encontrada' });
    }

    await prisma.financialTransaction.delete({ where: { id } });

    return reply.send({ success: true, message: 'Transação eliminada com sucesso' });
  }

  /**
   * GET /api/finance/summary/all
   * Resumo de receitas vs despesas (últimos 12 meses)
   */
  static async getSummary(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;

    const last12Months = new Date();
    last12Months.setMonth(last12Months.getMonth() - 12);

    const revenues = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'REVENUE',
        status: 'APPROVED',
        date: { gte: last12Months }
      },
      _sum: { amount: true }
    });

    const expenses = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'EXPENSE',
        status: 'APPROVED',
        date: { gte: last12Months }
      },
      _sum: { amount: true }
    });

    const totalRevenue = revenues._sum?.amount || 0;
    const totalExpense = expenses._sum?.amount || 0;
    const profit = totalRevenue - totalExpense;
    const profitMargin = totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(2) : '0';

    return reply.send({
      success: true,
      summary: {
        totalRevenue,
        totalExpense,
        profit,
        profitMargin: `${profitMargin}%`,
        period: 'Last 12 months'
      }
    });
  }

  /**
   * GET /api/finance/summary/by-category
   * Despesas por categoria
   */
  static async getExpensesByCategory(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { startDate, endDate } = req.query as any;

    const where: any = {
      tenantId,
      type: 'EXPENSE',
      status: 'APPROVED'
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const categories = await prisma.financialTransaction.groupBy({
      by: ['category'],
      where,
      _sum: { amount: true },
      _count: { id: true }
    });

    return reply.send({
      success: true,
      expenses: categories
        .filter(c => c.category !== null)
        .map(c => ({
          category: c.category,
          amount: c._sum?.amount || 0,
          transactionCount: c._count.id
        }))
        .sort((a, b) => b.amount - a.amount)
    });
  }
}
