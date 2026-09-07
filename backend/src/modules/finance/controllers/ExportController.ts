import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';

export class ExportController {
  /**
   * GET /api/finance/export/csv
   */
  static async exportCsv(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;

    const transactions = await prisma.financialTransaction.findMany({
      where: { tenantId },
      orderBy: { date: 'desc' }
    });

    const headers = ['ID', 'Data', 'Tipo', 'Estado', 'Descricao', 'Valor', 'Moeda', 'Categoria', 'Entidade', 'Fatura'];
    const rows = transactions.map(t => [
      t.id,
      t.date.toISOString().split('T')[0],
      t.type,
      t.status,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.amount.toFixed(2),
      t.currency,
      t.category || '',
      `"${(t.supplier || t.customer || '').replace(/"/g, '""')}"`,
      t.invoiceNumber || ''
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="export_finance.csv"');
    return reply.send(csvContent);
  }

  /**
   * GET /api/finance/export/saft
   * Exportação compatível com SAF-T (PT) para auditoria financeira
   */
  static async exportSaft(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const tenantId = user?.tenantId;
    const { year = new Date().getFullYear() } = req.query as any;

    const startYear = new Date(Number(year), 0, 1);
    const endYear = new Date(Number(year), 11, 31, 23, 59, 59, 999);

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        tenantId,
        date: { gte: startYear, lte: endYear }
      },
      orderBy: { date: 'asc' }
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    const saftData = {
      AuditFile: {
        Header: {
          AuditFileVersion: '1.04_01',
          CompanyID: tenant?.slug || tenant?.id,
          TaxRegistrationNumber: '999999990',
          TaxAccountingBasis: 'Faturacao e Contabilidade Integrada',
          CompanyName: tenant?.name || 'HelderLabs ERP Tenant',
          BusinessName: tenant?.name || 'HelderLabs',
          CompanyAddress: {
            AddressDetail: tenant?.address || 'Portugal',
            City: tenant?.city || 'Lisboa',
            PostalCode: tenant?.postalCode || '1000-001',
            Country: 'PT'
          },
          FiscalYear: Number(year),
          StartDate: startYear.toISOString().split('T')[0],
          EndDate: endYear.toISOString().split('T')[0],
          CurrencyCode: 'EUR',
          DateCreated: new Date().toISOString().split('T')[0],
          TaxEntity: 'Global',
          ProductCompanyTaxID: 'PT500000000',
          SoftwareCertificateNumber: '0/AT',
          ProductID: 'HelderLabs ERP/Finance',
          ProductVersion: '1.0-finance-module'
        },
        GeneralLedgerEntries: {
          NumberOfEntries: transactions.length,
          TotalDebit: transactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0),
          TotalCredit: transactions.filter(t => t.type === 'REVENUE').reduce((sum, t) => sum + t.amount, 0),
          Transactions: transactions.map(t => ({
            TransactionID: t.id,
            Period: t.date.toISOString().substring(0, 7),
            TransactionDate: t.date.toISOString().split('T')[0],
            TransactionType: t.type,
            Description: t.description,
            Amount: t.amount,
            Category: t.category,
            Status: t.status,
            InvoiceNumber: t.invoiceNumber
          }))
        }
      }
    };

    return reply.send({ success: true, saft: saftData });
  }
}
