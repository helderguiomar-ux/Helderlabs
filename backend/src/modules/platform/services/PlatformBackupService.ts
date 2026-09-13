import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';

export interface BackupManifest {
  version: string;
  type: 'TENANT' | 'ALL_TENANTS';
  tenantId?: string;
  tenantName?: string;
  exportedAt: string;
  totalTenants?: number;
  totalRows: number;
  tables: Record<string, { rowCount: number; sha256: string }>;
  checksum: string;
}

export class PlatformBackupService {
  private static TENANT_TABLES = [
    'tenant_company_profile',
    'tenant_module_subscriptions',
    'users',
    'roles',
    'audit_logs',
    // HCCALL
    'hccall_sales',
    'hccall_sale_items',
    'hccall_sale_changes',
    'hccall_sale_events',
    'hccall_products',
    'hccall_dynamizations',
    'hccall_dynamization_tiers',
    'hccall_dynamization_bonuses',
    'hccall_customers',
    'hccall_services',
    'hccall_promotions',
    'hccall_sale_statuses',
    'hccall_objectives',
    'hccall_alerts',
    // CRM
    'crm_companies',
    'crm_company_contacts',
    'crm_company_addresses',
    'crm_customers',
    'crm_leads',
    'crm_opportunities',
    'crm_contracts',
    // Finance
    'finance_accounts',
    'finance_transactions',
    'finance_categories',
    'cost_centers',
    'recurring_rules',
    'budgets',
    'budget_items',
    // Condominios
    'condo_buildings',
    'condo_building_units',
    'condo_unit_owners',
    'condo_expenses',
    'condo_fees',
    // Sellmais
    'sell_items',
    'sell_item_costs',
    'sell_item_media',
    'sell_item_events'
  ];

  /**
   * Exporta a cópia de segurança completa de um único tenant com manifesto e SHA-256
   */
  public static async exportTenantBackup(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (!tenant) {
      throw new Error('Tenant não encontrado para backup.');
    }

    const data: Record<string, any[]> = {};
    const tableMetadata: Record<string, { rowCount: number; sha256: string }> = {};
    let totalRows = 0;

    // Descobrir dinamicamente todas as tabelas públicas que contêm a coluna tenantId
    const tenantTableRecords = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(`
      SELECT table_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND column_name = 'tenantId'
      ORDER BY table_name;
    `);
    const tablesToExport = tenantTableRecords.map(r => r.table_name);

    for (const table of tablesToExport) {
      try {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `SELECT * FROM "${table}" WHERE "tenantId" = $1;`,
          tenantId
        );

        const safeRows = rows.map(r => JSON.parse(JSON.stringify(r, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v
        )));

        const tableJson = JSON.stringify(safeRows);
        const sha256 = crypto.createHash('sha256').update(tableJson).digest('hex');

        data[table] = safeRows;
        tableMetadata[table] = {
          rowCount: safeRows.length,
          sha256
        };
        totalRows += safeRows.length;
      } catch {
        // Continua com as restantes tabelas caso haja exceção
      }
    }

    const manifest: BackupManifest = {
      version: '2.0.0',
      type: 'TENANT',
      tenantId: tenant.id,
      tenantName: tenant.name,
      exportedAt: new Date().toISOString(),
      totalRows,
      tables: tableMetadata,
      checksum: ''
    };

    manifest.checksum = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

    return {
      manifest,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        status: tenant.status,
        createdAt: tenant.createdAt
      },
      data
    };
  }

  /**
   * Exporta a cópia de segurança consolidada de TODOS os tenants da plataforma
   */
  public static async exportAllTenantsBackup() {
    const allTenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'asc' }
    });

    const tenantBackups: any[] = [];
    let totalPlatformRows = 0;
    const globalTableStats: Record<string, { rowCount: number; sha256: string }> = {};

    for (const t of allTenants) {
      const bkp = await this.exportTenantBackup(t.id);
      tenantBackups.push(bkp);
      totalPlatformRows += bkp.manifest.totalRows;

      for (const [tbl, meta] of Object.entries(bkp.manifest.tables)) {
        if (!globalTableStats[tbl]) {
          globalTableStats[tbl] = { rowCount: 0, sha256: '' };
        }
        globalTableStats[tbl].rowCount += meta.rowCount;
      }
    }

    const modules = await prisma.module.findMany();

    const manifest: BackupManifest = {
      version: '2.0.0',
      type: 'ALL_TENANTS',
      totalTenants: allTenants.length,
      exportedAt: new Date().toISOString(),
      totalRows: totalPlatformRows,
      tables: globalTableStats,
      checksum: ''
    };

    manifest.checksum = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

    return {
      manifest,
      platform: {
        system: 'HelderLabs ERP',
        architecture: 'Multi-Tenant Hardened v2.0.0',
        exportedAt: new Date().toISOString(),
        totalTenants: allTenants.length,
        modules: modules.map(m => ({ key: m.key, name: m.name, category: m.category }))
      },
      tenants: tenantBackups
    };
  }
}
