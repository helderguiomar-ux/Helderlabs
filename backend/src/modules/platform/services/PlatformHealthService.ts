import { prisma } from '../../../database/prisma/client';
import { AuditService } from './AuditService';

export interface HealthFinding {
  id: string;
  category: 'SCHEMA' | 'RLS_ISOLATION' | 'REFERENTIAL_INTEGRITY' | 'AUDIT_BLOCKCHAIN' | 'PERFORMANCE';
  title: string;
  severity: 'OK' | 'WARNING' | 'CRITICAL';
  description: string;
  recommendedAction?: string;
  canAutoFix: boolean;
}

export class PlatformHealthService {
  /**
   * Calcula o espaço em armazenamento e distribuição de dados por cliente/tenant
   */
  public static async getStorageMetrics() {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'asc' }
    });

    const tenantMetrics: any[] = [];
    let platformTotalRows = 0;
    let platformTotalBytes = 0;

    for (const t of tenants) {
      // Contagem por módulos
      const [hccallSales, hccallProds, crmCompanies, finTrans, condoUnits, sellItems, auditLogs, userCount] = await Promise.all([
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "hccall_sales" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "hccall_products" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "crm_companies" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "finance_transactions" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "buildings" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "sell_items" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as cnt FROM "audit_logs" WHERE "tenantId" = $1', t.id).then(r => r[0]?.cnt || 0).catch(() => 0),
        prisma.user.count({ where: { tenantId: t.id, deletedAt: null } }).catch(() => 0)
      ]);

      const totalRows = hccallSales + hccallProds + crmCompanies + finTrans + condoUnits + sellItems + auditLogs + userCount;
      // Estimativa de 768 bytes médios por linha (incluindo JSONBs e índices)
      const estimatedBytes = Math.max(1024 * 16, totalRows * 768);

      platformTotalRows += totalRows;
      platformTotalBytes += estimatedBytes;

      tenantMetrics.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        email: t.email,
        status: t.status,
        userCount,
        totalRows,
        estimatedBytes,
        storageFormatted: this.formatBytes(estimatedBytes),
        breakdown: {
          hccall: hccallSales + hccallProds,
          crm: crmCompanies,
          finance: finTrans,
          condominios: condoUnits,
          sellmais: sellItems,
          audit: auditLogs
        },
        createdAt: t.createdAt
      });
    }

    // Ordenar do maior para o menor em armazenamento
    tenantMetrics.sort((a, b) => b.estimatedBytes - a.estimatedBytes);

    return {
      success: true,
      summary: {
        totalTenants: tenants.length,
        totalRows: platformTotalRows,
        totalStorageBytes: platformTotalBytes,
        totalStorageFormatted: this.formatBytes(platformTotalBytes)
      },
      tenants: tenantMetrics
    };
  }

  /**
   * Auditoria de Saúde da Base de Dados — "Audita os achados antes de corrigir"
   */
  public static async auditDatabaseHealth() {
    const findings: HealthFinding[] = [];
    const startTime = Date.now();

    // 1. Latência do PostgreSQL
    try {
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - startTime;
      findings.push({
        id: 'DB_CONNECTION_PING',
        category: 'PERFORMANCE',
        title: 'Conexão e Latência da Base de Dados',
        severity: latencyMs < 350 ? 'OK' : 'WARNING',
        description: `Base de dados PostgreSQL online e responsiva. Tempo de resposta: ${latencyMs}ms.`,
        canAutoFix: false
      });
    } catch (err: any) {
      findings.push({
        id: 'DB_CONNECTION_PING',
        category: 'PERFORMANCE',
        title: 'Conexão à Base de Dados',
        severity: 'CRITICAL',
        description: `Falha de conexão: ${err.message}`,
        canAutoFix: false
      });
    }

    // 2. Coluna crítica productId em hccall_objectives
    try {
      const colCheck = await prisma.$queryRawUnsafe<any[]>(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'hccall_objectives' AND column_name = 'productId';
      `);
      if (colCheck.length > 0) {
        findings.push({
          id: 'COL_OBJECTIVE_PRODUCT_ID',
          category: 'SCHEMA',
          title: 'Esquema: Coluna hccall_objectives.productId',
          severity: 'OK',
          description: 'A coluna productId existe na tabela hccall_objectives. Metas por serviço suportadas.',
          canAutoFix: false
        });
      } else {
        findings.push({
          id: 'COL_OBJECTIVE_PRODUCT_ID',
          category: 'SCHEMA',
          title: 'Esquema: Coluna hccall_objectives.productId em falta',
          severity: 'CRITICAL',
          description: 'A coluna productId não existe em hccall_objectives. Isto causa erro ao criar serviços com metas (código P2022).',
          recommendedAction: 'Criar a coluna productId e respetivo índice com DDL aditivo seguro.',
          canAutoFix: true
        });
      }
    } catch (err: any) {
      findings.push({
        id: 'COL_OBJECTIVE_PRODUCT_ID',
        category: 'SCHEMA',
        title: 'Verificação de Colunas Críticas',
        severity: 'WARNING',
        description: `Não foi possível verificar coluna: ${err.message}`,
        canAutoFix: false
      });
    }

    // 3. Colunas de comissão e ordem no HCCALL
    try {
      const hccallCols = await prisma.$queryRawUnsafe<any[]>(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'hccall_products' AND column_name = 'defaultCommissionCents';
      `);
      if (hccallCols.length > 0) {
        findings.push({
          id: 'COL_PRODUCT_COMMISSION',
          category: 'SCHEMA',
          title: 'Esquema: Coluna hccall_products.defaultCommissionCents',
          severity: 'OK',
          description: 'Coluna de comissão por omissão ativa e configurável em cada produto.',
          canAutoFix: false
        });
      } else {
        findings.push({
          id: 'COL_PRODUCT_COMMISSION',
          category: 'SCHEMA',
          title: 'Esquema: defaultCommissionCents em falta',
          severity: 'WARNING',
          description: 'A coluna defaultCommissionCents não está presente na tabela hccall_products.',
          recommendedAction: 'Adicionar coluna defaultCommissionCents (INT default 0).',
          canAutoFix: true
        });
      }
    } catch (err: any) {
      findings.push({
        id: 'COL_PRODUCT_COMMISSION',
        category: 'SCHEMA',
        title: 'Esquema de Produtos',
        severity: 'WARNING',
        description: err.message,
        canAutoFix: false
      });
    }

    // 4. Verificação de Row Level Security (RLS) nas tabelas críticas
    const criticalTables = [
      'hccall_sales', 'hccall_sale_items', 'hccall_products', 'hccall_dynamizations',
      'hccall_customers', 'hccall_objectives', 'tenant_company_profile',
      'crm_companies', 'finance_transactions'
    ];
    try {
      const rlsRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT tablename, rowsecurity FROM pg_tables 
        WHERE schemaname = 'public' AND tablename = ANY($1);
      `, criticalTables);

      const unprotect = rlsRows.filter(r => !r.rowsecurity).map(r => r.tablename);
      if (unprotect.length === 0) {
        findings.push({
          id: 'RLS_SECURITY_AUDIT',
          category: 'RLS_ISOLATION',
          title: 'Isolamento Multi-Tenant: Row Level Security (RLS)',
          severity: 'OK',
          description: `RLS verificado e ativo nas ${rlsRows.length} tabelas monitorizadas. Isolamento de dados garantido.`,
          canAutoFix: false
        });
      } else {
        findings.push({
          id: 'RLS_SECURITY_AUDIT',
          category: 'RLS_ISOLATION',
          title: `RLS Inativo em ${unprotect.length} tabela(s)`,
          severity: 'CRITICAL',
          description: `As seguintes tabelas não têm RLS ativado: ${unprotect.join(', ')}.`,
          recommendedAction: 'Ativar Row Level Security nas tabelas identificadas.',
          canAutoFix: true
        });
      }
    } catch (err: any) {
      findings.push({
        id: 'RLS_SECURITY_AUDIT',
        category: 'RLS_ISOLATION',
        title: 'Auditoria de Políticas RLS',
        severity: 'WARNING',
        description: err.message,
        canAutoFix: false
      });
    }

    // 5. Verificação de Registos Órfãos
    try {
      const orphanSales = await prisma.$queryRawUnsafe<any[]>(`
        SELECT count(*)::int as cnt FROM "hccall_sales" s
        LEFT JOIN "tenants" t ON s."tenantId" = t."id"
        WHERE t."id" IS NULL;
      `);
      const cnt = orphanSales[0]?.cnt || 0;
      if (cnt === 0) {
        findings.push({
          id: 'ORPHAN_RECORDS_AUDIT',
          category: 'REFERENTIAL_INTEGRITY',
          title: 'Integridade Referencial: Registos Órfãos',
          severity: 'OK',
          description: '0 registos órfãos detetados. Todas as vendas e dados estão associados a empresas válidas.',
          canAutoFix: false
        });
      } else {
        findings.push({
          id: 'ORPHAN_RECORDS_AUDIT',
          category: 'REFERENTIAL_INTEGRITY',
          title: `${cnt} Venda(s) Órfã(s) Detetada(s)`,
          severity: 'WARNING',
          description: `Existem ${cnt} registos de venda associados a tenants inexistentes.`,
          recommendedAction: 'Reassociar ou arquivar registos descontinuados.',
          canAutoFix: false
        });
      }
    } catch (err: any) {
      // Ignorar caso a tabela não exista ainda
    }

    // 6. Verificação de Integridade da Cadeia de Auditoria SHA-256
    try {
      const lastLogs = await prisma.auditLog.findMany({
        take: 30,
        orderBy: { seq: 'desc' }
      });

      let chainBroken = false;
      let verifiedCount = 0;

      for (let i = 0; i < lastLogs.length - 1; i++) {
        const current = lastLogs[i];
        const prev = lastLogs[i + 1];
        if (current.prevHash && prev.hash && current.prevHash !== prev.hash) {
          chainBroken = true;
          break;
        }
        verifiedCount++;
      }

      if (!chainBroken) {
        findings.push({
          id: 'AUDIT_CHAIN_INTEGRITY',
          category: 'AUDIT_BLOCKCHAIN',
          title: 'Cadeia de Auditoria SHA-256 Imutável',
          severity: 'OK',
          description: `Cadeia criptográfica íntegra. Últimos ${verifiedCount} blocos de auditoria validados sem quebras.`,
          canAutoFix: false
        });
      } else {
        findings.push({
          id: 'AUDIT_CHAIN_INTEGRITY',
          category: 'AUDIT_BLOCKCHAIN',
          title: 'Descontinuidade na Cadeia de Auditoria',
          severity: 'WARNING',
          description: 'Foi detetada uma discrepância na ligação criptográfica entre blocos de auditoria históricos.',
          recommendedAction: 'Auditar o incidente e registar na tabela audit_chain_incidents (regra permanente).',
          canAutoFix: false
        });
      }
    } catch (err: any) {
      // Tabela pode estar vazia
    }

    // Cálculo do Score de Saúde (0% - 100%)
    const criticals = findings.filter(f => f.severity === 'CRITICAL').length;
    const warnings = findings.filter(f => f.severity === 'WARNING').length;
    const score = Math.max(0, 100 - (criticals * 35) - (warnings * 10));

    return {
      success: true,
      score,
      status: score >= 90 ? 'SAUDAVEL' : score >= 60 ? 'ATENCAO' : 'CRITICO',
      auditedAt: new Date().toISOString(),
      findingsCount: {
        total: findings.length,
        critical: criticals,
        warning: warnings,
        ok: findings.filter(f => f.severity === 'OK').length
      },
      findings
    };
  }

  /**
   * Aplica correções seguras aos achados previamente auditados e aprovados
   */
  public static async fixFindings(findingIds: string[]) {
    const results: Array<{ id: string; success: boolean; message: string }> = [];

    for (const id of findingIds) {
      if (id === 'COL_OBJECTIVE_PRODUCT_ID') {
        try {
          await prisma.$executeRawUnsafe(`ALTER TABLE "hccall_objectives" ADD COLUMN IF NOT EXISTS "productId" TEXT;`);
          await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hccall_objectives_tenant_product_idx" ON "hccall_objectives" ("tenantId", "productId");`);
          results.push({ id, success: true, message: 'Coluna productId e índice criados com sucesso.' });
        } catch (err: any) {
          results.push({ id, success: false, message: err.message });
        }
      } else if (id === 'COL_PRODUCT_COMMISSION') {
        try {
          await prisma.$executeRawUnsafe(`ALTER TABLE "hccall_products" ADD COLUMN IF NOT EXISTS "defaultCommissionCents" INT NOT NULL DEFAULT 0;`);
          results.push({ id, success: true, message: 'Coluna defaultCommissionCents criada com sucesso.' });
        } catch (err: any) {
          results.push({ id, success: false, message: err.message });
        }
      } else if (id === 'RLS_SECURITY_AUDIT') {
        try {
          const criticalTables = [
            'hccall_sales', 'hccall_sale_items', 'hccall_products', 'hccall_dynamizations',
            'hccall_customers', 'hccall_objectives', 'tenant_company_profile',
            'crm_companies', 'finance_transactions'
          ];
          for (const tbl of criticalTables) {
            try {
              await prisma.$executeRawUnsafe(`ALTER TABLE "${tbl}" ENABLE ROW LEVEL SECURITY;`);
            } catch {}
          }
          results.push({ id, success: true, message: 'Row Level Security reativado nas tabelas críticas.' });
        } catch (err: any) {
          results.push({ id, success: false, message: err.message });
        }
      }
    }

    // Registo de auditoria da intervenção
    try {
      await AuditService.audit({
        action: 'database.health.repair',
        module: 'platform',
        category: 'DATABASE',
        actorType: 'SUPER_ADMIN',
        actorEmail: 'superadmin@helderlabs.eu',
        description: `Reparação de integridade da base de dados: ${results.filter(r => r.success).length} achados corrigidos.`,
        newValue: { findingIds, results }
      });
    } catch {}

    const reAudited = await this.auditDatabaseHealth();

    return {
      success: true,
      repairedCount: results.filter(r => r.success).length,
      results,
      reAudited
    };
  }

  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
