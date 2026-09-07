import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { ReportSchema } from '../middleware/financialValidation.middleware';

export class ReportsController {
  /**
   * POST /api/finance/reports
   * Gerar relatório financeiro (P&L, Balance Sheet, Cash Flow)
   */
  static async generateReport(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const body = ReportSchema.parse(req.body);

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    // Coletar dados
    const revenues = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'REVENUE',
        status: 'APPROVED',
        date: { gte: startDate, lte: endDate }
      },
      _sum: { amount: true }
    });

    const expenses = await prisma.financialTransaction.aggregate({
      where: {
        tenantId,
        type: 'EXPENSE',
        status: 'APPROVED',
        date: { gte: startDate, lte: endDate }
      },
      _sum: { amount: true }
    });

    const expensesByCategory = await prisma.financialTransaction.groupBy({
      by: ['category'],
      where: {
        tenantId,
        type: 'EXPENSE',
        status: 'APPROVED',
        date: { gte: startDate, lte: endDate }
      },
      _sum: { amount: true }
    });

    const totalRevenue = revenues._sum?.amount || 0;
    const totalExpense = expenses._sum?.amount || 0;
    const profit = totalRevenue - totalExpense;

    let reportData: any = {};

    if (body.reportType === 'P&L') {
      reportData = {
        revenues: totalRevenue,
        expenses: totalExpense,
        grossProfit: totalRevenue - totalExpense,
        profitMargin: totalRevenue > 0 ? `${((profit / totalRevenue) * 100).toFixed(2)}%` : '0%',
        expenseBreakdown: expensesByCategory
          .filter(e => e.category !== null)
          .map(e => ({
            category: e.category,
            amount: e._sum?.amount || 0,
            percentage: totalExpense > 0 ? `${(((e._sum?.amount || 0) / totalExpense) * 100).toFixed(2)}%` : '0%'
          }))
      };
    } else {
      reportData = {
        revenues: totalRevenue,
        expenses: totalExpense,
        netBalance: profit,
        period: body.period
      };
    }

    // Guardar relatório
    const report = await prisma.financialReport.create({
      data: {
        tenantId,
        reportType: body.reportType,
        period: body.period,
        startDate,
        endDate,
        data: reportData
      }
    });

    return reply.status(201).send({
      success: true,
      report: {
        id: report.id,
        type: report.reportType,
        period: report.period,
        startDate: report.startDate,
        endDate: report.endDate,
        generatedAt: report.createdAt,
        data: reportData
      }
    });
  }

  /**
   * GET /api/finance/reports/:id
   * Obter relatório gerado
   */
  static async getReport(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { id } = req.params as any;

    const report = await prisma.financialReport.findFirst({
      where: { id, tenantId }
    });

    if (!report) {
      return reply.status(404).send({ error: 'REPORT_NOT_FOUND', message: 'Relatório não encontrado' });
    }

    return reply.send({
      success: true,
      report: {
        id: report.id,
        type: report.reportType,
        period: report.period,
        startDate: report.startDate,
        endDate: report.endDate,
        data: report.data,
        generatedAt: report.createdAt
      }
    });
  }
}
