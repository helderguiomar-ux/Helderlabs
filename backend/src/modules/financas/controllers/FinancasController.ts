import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { forTenant } from '../../../database/prisma/tenantScopedClient';
import { RecurrenceService } from '../services/RecurrenceService';
import { seedFinancas } from '../services/seedFinancas';
import { FinanceCalcService } from '../services/FinanceCalcService';

// Validation Schemas
const AccountSchema = z.object({
  name: z.string().min(1, 'Nome da conta é obrigatório'),
  accountType: z.enum(['BANK', 'CASH', 'DIGITAL', 'SAVINGS', 'OTHER']).default('BANK'),
  openingBalanceCents: z.number().int().default(0),
  currency: z.string().default('EUR'),
  iban: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  isDefault: z.boolean().default(false)
});

const CostCenterSchema = z.object({
  code: z.string().min(1, 'Código é obrigatório'),
  name: z.string().min(1, 'Nome do centro de custo é obrigatório'),
  description: z.string().optional().nullable(),
  parentId: z.string().optional().nullable()
});

const CategorySchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  kind: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().optional(),
  icon: z.string().optional(),
  parentId: z.string().optional().nullable(),
  budgetAmountCents: z.number().int().optional().nullable()
});

const TransactionSchema = z.object({
  description: z.string().min(1, 'Descrição é obrigatória'),
  kind: z.enum(['INCOME', 'EXPENSE']),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  amountCents: z.number().int().min(1, 'Valor em cêntimos deve ser positivo'),
  currency: z.string().default('EUR'),
  dueDate: z.string().or(z.date()),
  paidDate: z.string().or(z.date()).optional().nullable(),
  status: z.enum(['PLANNED', 'PAID', 'CANCELLED']).default('PLANNED'),
  accountId: z.string().optional().nullable(),
  transferToId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  costCenterId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  counterpartyName: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  approvalStatus: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']).optional().default('NONE'),
  notes: z.string().optional().nullable(),
  method: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([])
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

const AttachmentSchema = z.object({
  fileName: z.string().min(1, 'Nome do ficheiro é obrigatório'),
  fileUrl: z.string().min(1, 'URL do ficheiro é obrigatório'),
  fileType: z.string().optional().nullable(),
  size: z.number().int().optional().nullable()
});

export class FinancasController {

  // =========================================================================
  // CONTAS FINANCEIRAS / CAIXA
  // =========================================================================

  /** GET /api/financas/accounts */
  static async listAccounts(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const [accounts, transactions] = await Promise.all([
      db.financeAccount.findMany({
        where: { deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
      }),
      db.financeTransaction.findMany({
        where: { tenantId: user.tenantId, deletedAt: null }
      })
    ]);

    const liveAccounts = accounts.map((acc: any) => {
      let balance = acc.openingBalanceCents || 0;
      for (const t of transactions) {
        const isPaid = t.status === 'PAID' || t.paidDate !== null;
        if (!isPaid) continue;

        if (t.type === 'TRANSFER') {
          if (t.accountId === acc.id) balance -= t.amountCents;
          if (t.transferToId === acc.id) balance += t.amountCents;
        } else {
          if (t.accountId === acc.id) {
            if (t.kind === 'INCOME') balance += t.amountCents;
            else if (t.kind === 'EXPENSE') balance -= t.amountCents;
          }
        }
      }

      return {
        ...acc,
        currentBalanceCents: balance
      };
    });

    return reply.send({ success: true, accounts: liveAccounts });
  }

  /** POST /api/financas/accounts */
  static async createAccount(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = AccountSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    if (body.isDefault) {
      await db.financeAccount.updateMany({
        where: { tenantId: user.tenantId },
        data: { isDefault: false }
      });
    }

    const account = await db.financeAccount.create({
      data: {
        tenantId: user.tenantId,
        name: body.name,
        accountType: body.accountType,
        openingBalanceCents: body.openingBalanceCents,
        currentBalanceCents: body.openingBalanceCents,
        currency: body.currency,
        iban: body.iban || null,
        description: body.description || null,
        isDefault: body.isDefault
      }
    });

    return reply.status(201).send({ success: true, account });
  }

  /** PUT /api/financas/accounts/:id */
  static async updateAccount(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = AccountSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);

    if (body.isDefault) {
      await db.financeAccount.updateMany({
        where: { tenantId: user.tenantId, id: { not: id } },
        data: { isDefault: false }
      });
    }

    const account = await db.financeAccount.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.accountType && { accountType: body.accountType }),
        ...(body.openingBalanceCents !== undefined && { openingBalanceCents: body.openingBalanceCents }),
        ...(body.currency && { currency: body.currency }),
        ...(body.iban !== undefined && { iban: body.iban }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isDefault !== undefined && { isDefault: body.isDefault })
      }
    });

    return reply.send({ success: true, account });
  }

  /** DELETE /api/financas/accounts/:id (Soft-Delete) */
  static async deleteAccount(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.financeAccount.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Conta financeira arquivada com sucesso.' });
  }

  /** POST /api/financas/accounts/:id/restore */
  static async restoreAccount(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    const account = await db.financeAccount.update({
      where: { id },
      data: { deletedAt: null }
    });

    return reply.send({ success: true, account });
  }

  // =========================================================================
  // CENTROS DE CUSTO
  // =========================================================================

  /** GET /api/financas/cost-centers */
  static async listCostCenters(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const costCenters = await db.costCenter.findMany({
      where: { deletedAt: null },
      include: { parent: true, children: true },
      orderBy: { code: 'asc' }
    });

    return reply.send({ success: true, costCenters });
  }

  /** POST /api/financas/cost-centers */
  static async createCostCenter(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CostCenterSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const costCenter = await db.costCenter.create({
      data: {
        tenantId: user.tenantId,
        code: body.code,
        name: body.name,
        description: body.description || null,
        parentId: body.parentId || null
      }
    });

    return reply.status(201).send({ success: true, costCenter });
  }

  /** PUT /api/financas/cost-centers/:id */
  static async updateCostCenter(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CostCenterSchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);

    const costCenter = await db.costCenter.update({
      where: { id },
      data: {
        ...(body.code && { code: body.code }),
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.parentId !== undefined && { parentId: body.parentId })
      }
    });

    return reply.send({ success: true, costCenter });
  }

  /** DELETE /api/financas/cost-centers/:id */
  static async deleteCostCenter(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.costCenter.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Centro de custo arquivado com sucesso.' });
  }

  // =========================================================================
  // CATEGORIAS & ORÇAMENTOS
  // =========================================================================

  /** GET /api/financas/categories */
  static async listCategories(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const count = await db.financeCategory.count({ where: { deletedAt: null } });
    if (count === 0) {
      await seedFinancas(user.tenantId);
    }

    const categories = await db.financeCategory.findMany({
      where: { deletedAt: null },
      include: { parent: true, children: true },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
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
        icon: body.icon || 'tag',
        parentId: body.parentId || null,
        budgetAmountCents: body.budgetAmountCents || null
      }
    });

    return reply.status(201).send({ success: true, category });
  }

  /** PUT /api/financas/categories/:id */
  static async updateCategory(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = CategorySchema.partial().parse(req.body);
    const db = forTenant(user.tenantId);

    const category = await db.financeCategory.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.kind && { kind: body.kind }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.icon !== undefined && { icon: body.icon }),
        ...(body.parentId !== undefined && { parentId: body.parentId }),
        ...(body.budgetAmountCents !== undefined && { budgetAmountCents: body.budgetAmountCents })
      }
    });

    return reply.send({ success: true, category });
  }

  /** DELETE /api/financas/categories/:id */
  static async deleteCategory(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.financeCategory.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Categoria arquivada com sucesso.' });
  }

  /** POST /api/financas/categories/:id/restore */
  static async restoreCategory(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    const category = await db.financeCategory.update({
      where: { id },
      data: { deletedAt: null }
    });

    return reply.send({ success: true, category });
  }

  /** GET /api/financas/categories/budget-status */
  static async getBudgetStatus(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { period } = req.query as { period?: string };
    const db = forTenant(user.tenantId);

    const budgetStatus = await FinanceCalcService.calculateCategoryBudgets(db, user.tenantId, period);
    return reply.send({ success: true, budgetStatus });
  }

  // =========================================================================
  // TRANSAÇÕES FINANCEIRAS
  // =========================================================================

  /** GET /api/financas/transactions */
  static async listTransactions(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as {
      kind?: string;
      status?: string;
      approvalStatus?: string;
      categoryId?: string;
      accountId?: string;
      costCenterId?: string;
      companyId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      includeDeleted?: string;
    };
    const db = forTenant(user.tenantId);

    const where: any = {};
    if (query.includeDeleted !== 'true') {
      where.deletedAt = null;
    }
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.accountId) where.accountId = query.accountId;
    if (query.costCenterId) where.costCenterId = query.costCenterId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { counterpartyName: { contains: query.search, mode: 'insensitive' } },
        { documentNumber: { contains: query.search, mode: 'insensitive' } }
      ];
    }
    if (query.startDate || query.endDate) {
      where.dueDate = {};
      if (query.startDate) where.dueDate.gte = new Date(query.startDate);
      if (query.endDate) where.dueDate.lte = new Date(query.endDate);
    }

    const transactions = await db.financeTransaction.findMany({
      where,
      include: {
        category: true,
        account: true,
        transferToAccount: true,
        costCenter: true,
        company: true,
        attachments: { where: { deletedAt: null } }
      },
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
    const status = body.status || (paidDate ? 'PAID' : 'PLANNED');

    const transaction = await db.financeTransaction.create({
      data: {
        tenantId: user.tenantId,
        description: body.description,
        kind: body.kind,
        type: body.type || (body.kind === 'INCOME' ? 'INCOME' : 'EXPENSE'),
        amountCents: body.amountCents,
        currency: body.currency || 'EUR',
        dueDate,
        paidDate,
        status,
        accountId: body.accountId || null,
        transferToId: body.transferToId || null,
        categoryId: body.categoryId || null,
        costCenterId: body.costCenterId || null,
        companyId: body.companyId || null,
        counterpartyName: body.counterpartyName || null,
        documentNumber: body.documentNumber || null,
        approvalStatus: body.approvalStatus || 'NONE',
        notes: body.notes || null,
        method: body.method || null,
        tags: body.tags || []
      },
      include: {
        category: true,
        account: true,
        transferToAccount: true,
        costCenter: true,
        company: true
      }
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
        ...(body.type && { type: body.type }),
        ...(body.amountCents !== undefined && { amountCents: body.amountCents }),
        ...(body.currency && { currency: body.currency }),
        ...(body.dueDate && { dueDate }),
        paidDate,
        status,
        ...(body.accountId !== undefined && { accountId: body.accountId }),
        ...(body.transferToId !== undefined && { transferToId: body.transferToId }),
        ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
        ...(body.costCenterId !== undefined && { costCenterId: body.costCenterId }),
        ...(body.companyId !== undefined && { companyId: body.companyId }),
        ...(body.counterpartyName !== undefined && { counterpartyName: body.counterpartyName }),
        ...(body.documentNumber !== undefined && { documentNumber: body.documentNumber }),
        ...(body.approvalStatus !== undefined && { approvalStatus: body.approvalStatus }),
        ...(body.notes !== undefined && { notes: body.notes }),
        ...(body.method !== undefined && { method: body.method }),
        ...(body.tags !== undefined && { tags: body.tags }),
        overriddenAt: new Date()
      },
      include: {
        category: true,
        account: true,
        transferToAccount: true,
        costCenter: true,
        company: true
      }
    });

    return reply.send({ success: true, transaction: updated });
  }

  /** PATCH /api/financas/transactions/:id/pay */
  static async payTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({ isPaid: z.boolean().default(true), paidDate: z.string().optional() }).parse(req.body || {});
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
      include: { category: true, account: true }
    });

    return reply.send({ success: true, transaction: updated });
  }

  /** PATCH /api/financas/transactions/:id/approve */
  static async approveTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).parse(req.body);
    const db = forTenant(user.tenantId);

    const updated = await db.financeTransaction.update({
      where: { id },
      data: {
        approvalStatus: body.status,
        approvedBy: user.email || user.sub,
        approvedAt: new Date()
      },
      include: { category: true }
    });

    return reply.send({ success: true, transaction: updated });
  }

  /** DELETE /api/financas/transactions/:id (Soft Delete) */
  static async deleteTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.financeTransaction.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Transação arquivada com sucesso.' });
  }

  /** POST /api/financas/transactions/:id/restore */
  static async restoreTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    const transaction = await db.financeTransaction.update({
      where: { id },
      data: { deletedAt: null },
      include: { category: true }
    });

    return reply.send({ success: true, transaction });
  }

  // =========================================================================
  // ANEXOS DE TRANSAÇÃO
  // =========================================================================

  /** GET /api/financas/transactions/:id/attachments */
  static async listAttachments(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    const attachments = await db.financeAttachment.findMany({
      where: { transactionId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' }
    });

    return reply.send({ success: true, attachments });
  }

  /** POST /api/financas/transactions/:id/attachments */
  static async createAttachment(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = AttachmentSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const attachment = await db.financeAttachment.create({
      data: {
        transactionId: id,
        fileName: body.fileName,
        fileUrl: body.fileUrl,
        fileType: body.fileType || null,
        size: body.size || null,
        uploadedBy: user.email || user.sub
      }
    });

    return reply.status(201).send({ success: true, attachment });
  }

  /** DELETE /api/financas/attachments/:attachmentId */
  static async deleteAttachment(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { attachmentId } = req.params as { attachmentId: string };
    const db = forTenant(user.tenantId);

    await db.financeAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Anexo removido com sucesso.' });
  }

  // =========================================================================
  // RECORRÊNCIAS
  // =========================================================================

  /** GET /api/financas/recurring */
  static async listRecurringRules(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const rules = await db.recurringRule.findMany({
      where: { deletedAt: null },
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

  /** DELETE /api/financas/recurring/:id */
  static async deleteRecurringRule(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.recurringRule.update({
      where: { id },
      data: { deletedAt: new Date(), active: false }
    });

    return reply.send({ success: true, message: 'Regra recorrente arquivada com sucesso.' });
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

  // =========================================================================
  // EMPRÉSTIMOS
  // =========================================================================

  /** GET /api/financas/loans */
  static async listLoans(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const loans = await db.loan.findMany({
      where: { deletedAt: null },
      include: { payments: { where: { deletedAt: null } } },
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

  /** DELETE /api/financas/loans/:id */
  static async deleteLoan(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const db = forTenant(user.tenantId);

    await db.loan.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    return reply.send({ success: true, message: 'Empréstimo arquivado com sucesso.' });
  }

  /** POST /api/financas/loans/:id/payments */
  static async recordLoanPayment(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { id } = req.params as { id: string };
    const body = LoanPaymentSchema.parse(req.body);
    const db = forTenant(user.tenantId);

    const loan = await db.loan.findUnique({
      where: { id },
      include: { payments: { where: { deletedAt: null } } }
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

  // =========================================================================
  // DASHBOARD, KPIS, PROJEÇÕES & ANÁLISES
  // =========================================================================

  /** GET /api/financas/dashboard */
  static async getDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const db = forTenant(user.tenantId);

    await RecurrenceService.materialize(user.tenantId, new Date(), db);

    const kpis = await FinanceCalcService.calculateKPIs(db, user.tenantId, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined
    });

    const burnRate = await FinanceCalcService.calculateBurnRate(db, user.tenantId);
    const budgetStatus = await FinanceCalcService.calculateCategoryBudgets(db, user.tenantId);

    return reply.send({
      success: true,
      kpis,
      burnRate,
      budgetStatus
    });
  }

  /** GET /api/financas/projections */
  static async getCashFlowProjections(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { days } = req.query as { days?: string };
    const db = forTenant(user.tenantId);

    const daysCount = days ? parseInt(days, 10) : 90;
    const projections = await FinanceCalcService.calculateCashFlowProjections(db, user.tenantId, daysCount);

    return reply.send({ success: true, ...projections });
  }

  /** GET /api/financas/burn-rate */
  static async getBurnRate(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const db = forTenant(user.tenantId);

    const burnRate = await FinanceCalcService.calculateBurnRate(db, user.tenantId);
    return reply.send({ success: true, burnRate });
  }

  /** GET /api/financas/export */
  static async exportData(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { format } = req.query as { format?: string };
    const db = forTenant(user.tenantId);

    const transactions = await db.financeTransaction.findMany({
      where: { deletedAt: null },
      include: { category: true, account: true },
      orderBy: { dueDate: 'desc' }
    });

    if (format === 'csv') {
      const headers = 'ID,Descrição,Tipo,Valor (EUR),Data Vencimento,Estado,Conta,Categoria\n';
      const rows = transactions.map((t: any) =>
        `"${t.id}","${t.description.replace(/"/g, '""')}","${t.kind}",${(t.amountCents / 100).toFixed(2)},"${t.dueDate.toISOString().substring(0, 10)}","${t.status}","${t.account?.name || ''}","${t.category?.name || ''}"`
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
      data: { notes: 'ANONYMIZED_GDPR', description: 'Transação Anonimizada', counterpartyName: 'Anonimizado' }
    });

    await db.loan.updateMany({
      where: { tenantId: user.tenantId },
      data: { counterparty: 'Anonimizado RGPD', phone: null, email: null, notes: null }
    });

    return reply.send({ success: true, message: 'Dados financeiros anonimizados em conformidade com o RGPD.' });
  }
}
