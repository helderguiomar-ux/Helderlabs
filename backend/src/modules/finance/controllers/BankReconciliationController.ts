import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { z } from 'zod';

const CreateReconciliationSchema = z.object({
  statementDate: z.string(),
  statementAmount: z.number(),
  reconciliationNotes: z.string().optional()
});

const ReconcileTransactionSchema = z.object({
  transactionId: z.string(),
  isReconciled: z.boolean().default(true),
  bankStatementRef: z.string().optional()
});

export class BankReconciliationController {
  /**
   * GET /api/finance/reconciliation
   */
  static async listReconciliations(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;

    const list = await prisma.bankReconciliation.findMany({
      where: { tenantId },
      orderBy: { statementDate: 'desc' }
    });

    return reply.send({ success: true, reconciliations: list });
  }

  /**
   * POST /api/finance/reconciliation
   */
  static async createReconciliation(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const body = CreateReconciliationSchema.parse(req.body);

    const reconciliation = await prisma.bankReconciliation.create({
      data: {
        tenantId,
        statementDate: new Date(body.statementDate),
        statementAmount: body.statementAmount,
        reconciliationNotes: body.reconciliationNotes || undefined
      }
    });

    return reply.status(201).send({ success: true, reconciliation });
  }

  /**
   * POST /api/finance/reconciliation/reconcile-transaction
   */
  static async reconcileTransaction(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const body = ReconcileTransactionSchema.parse(req.body);

    const existing = await prisma.financialTransaction.findFirst({
      where: { id: body.transactionId, tenantId }
    });

    if (!existing) {
      return reply.status(404).send({ error: 'TRANSACTION_NOT_FOUND' });
    }

    const updated = await prisma.financialTransaction.update({
      where: { id: body.transactionId },
      data: {
        status: body.isReconciled ? 'RECONCILED' : 'APPROVED',
        reconciliationStatus: body.isReconciled ? 'RECONCILED' : 'UNRECONCILED',
        reconciliationDate: body.isReconciled ? new Date() : null,
        bankStatementRef: body.bankStatementRef || existing.bankStatementRef
      }
    });

    return reply.send({ success: true, transaction: updated });
  }
}
