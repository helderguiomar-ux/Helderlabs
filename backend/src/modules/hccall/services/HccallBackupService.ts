import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';

export class HccallBackupService {
  /**
   * Exporta os dados do tenant em formato NDJSON com manifesto e checksum SHA-256
   */
  public static async exportTenantBackup(tenantId: string): Promise<{
    manifest: any;
    data: Record<string, string>;
  }> {
    const tables = [
      'hccall_sales', 'hccall_sale_items', 'hccall_sale_changes', 'hccall_sale_events',
      'hccall_products', 'hccall_dynamizations', 'hccall_dynamization_tiers', 'hccall_dynamization_bonuses',
      'hccall_customers', 'hccall_services', 'hccall_promotions', 'hccall_sale_statuses',
      'hccall_objectives', 'tenant_company_profile'
    ];

    const data: Record<string, string> = {};
    const tableMetadata: Record<string, any> = {};
    let totalRows = 0;

    for (const table of tables) {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT * FROM "${table}" WHERE "tenantId" = '${tenantId}';
      `);
      const ndjson = rows.map(r => JSON.stringify(r, (_, v) => typeof v === 'bigint' ? v.toString() : v)).join('\n');
      const sha256 = crypto.createHash('sha256').update(ndjson).digest('hex');

      data[table] = ndjson;
      tableMetadata[table] = {
        rowCount: rows.length,
        sha256
      };
      totalRows += rows.length;
    }

    const lastAuditLog = await prisma.auditLog.findFirst({
      where: { tenantId },
      orderBy: { seq: 'desc' },
      select: { seq: true, hash: true }
    });

    const manifest = {
      tenantId,
      exportedAt: new Date().toISOString(),
      schemaVersion: '2.0.0',
      totalRows,
      tables: tableMetadata,
      lastAuditSeq: lastAuditLog?.seq ? Number(lastAuditLog.seq) : null,
      lastAuditHash: lastAuditLog?.hash || null,
      manifestSha256: ''
    };

    manifest.manifestSha256 = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

    return { manifest, data };
  }
}
