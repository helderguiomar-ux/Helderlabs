import { prisma } from '../../../database/prisma/client';

export class ReportService {
  static async getReports(tenantId: string, type?: string) {
    return prisma.financialReport.findMany({
      where: {
        tenantId,
        ...(type && { reportType: type })
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
