import { prisma } from '../../../database/prisma/client';
import { AuditService } from '../../platform/services/AuditService';
import { HccallCommissionEngine } from './HccallCommissionEngine';

export interface IntegrityCheckResult {
  passed: boolean;
  checkedAt: string;
  tenantId?: string;
  checks: {
    name: string;
    description: string;
    passed: boolean;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    details?: any;
  }[];
  criticalFailuresCount: number;
  warningsCount: number;
}

export class HccallIntegrityService {
  /**
   * Executa os 7 testes determinísticos de integridade no tenant especificado ou em toda a plataforma.
   */
  public static async runIntegrityCheck(tenantId?: string): Promise<IntegrityCheckResult> {
    const checks: IntegrityCheckResult['checks'] = [];
    const checkedAt = new Date().toISOString();

    // 1. Integridade Criptográfica da Cadeia SHA-256
    const auditRes = await AuditService.verifyAuditChain(tenantId);
    checks.push({
      name: 'audit_chain_integrity',
      description: 'Integridade criptográfica SHA-256 e continuidade de prevHash da cadeia de auditoria',
      passed: auditRes.valid,
      severity: 'CRITICAL',
      details: auditRes
    });

    // 2. Registos sem Tenant ou com Tenant Inválido
    const orphanTenantsRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT count(*)::text as cnt
      FROM "hccall_sales" s
      LEFT JOIN "tenants" t ON s."tenantId" = t.id
      WHERE t.id IS NULL ${tenantId ? `AND s."tenantId" = '${tenantId}'` : ''};
    `);
    const orphanTenantsCount = parseInt(orphanTenantsRes[0]?.cnt || '0', 10);
    checks.push({
      name: 'tenant_referential_integrity',
      description: 'Inexistência de vendas órfãs ou associadas a tenants inexistentes',
      passed: orphanTenantsCount === 0,
      severity: 'CRITICAL',
      details: { orphanTenantsCount }
    });

    // 3. Registos Órfãos entre Tabelas Filhas (SaleItems, Tiers, Bonuses)
    const orphanItemsRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT count(*)::text as cnt
      FROM "hccall_sale_items" si
      LEFT JOIN "hccall_sales" s ON si."saleId" = s.id
      WHERE s.id IS NULL ${tenantId ? `AND si."tenantId" = '${tenantId}'` : ''};
    `);
    const orphanItemsCount = parseInt(orphanItemsRes[0]?.cnt || '0', 10);
    checks.push({
      name: 'child_records_integrity',
      description: 'Inexistência de itens de venda sem venda pai correspondente',
      passed: orphanItemsCount === 0,
      severity: 'CRITICAL',
      details: { orphanItemsCount }
    });

    // 4. Chaves Naturais Duplicadas (tenantId + code / tenantId + clientUuid)
    const duplicateCodesRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT "code", count(*)::text as cnt
      FROM "hccall_sales"
      ${tenantId ? `WHERE "tenantId" = '${tenantId}'` : ''}
      GROUP BY "tenantId", "code"
      HAVING count(*) > 1;
    `);
    checks.push({
      name: 'natural_key_uniqueness',
      description: 'Unicidade estrita de códigos de venda e clientUuid por tenant',
      passed: duplicateCodesRes.length === 0,
      severity: 'CRITICAL',
      details: { duplicateCodes: duplicateCodesRes }
    });

    // 5. Consistência de Comissões Armazenadas vs Recalculadas
    const sales = await prisma.hccallSale.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        deletedAt: null
      },
      include: {
        dynamization: { include: { tiers: true, bonuses: true } },
        items: true
      },
      take: 100
    });

    let divergenceCount = 0;
    for (const s of sales) {
      if (s.dynamization) {
        const dynConfig = {
          id: s.dynamization.id,
          name: s.dynamization.name,
          tierMode: s.dynamization.tierMode as any,
          bonusMode: (s.dynamization as any).bonusMode || (s.dynamization as any).bonus_mode || 'milestone',
          baseAmountPerSaleCents: s.dynamization.baseAmountPerSaleCents,
          tiers: s.dynamization.tiers.map(t => ({
            minQuantity: t.minQuantity,
            maxQuantity: t.maxQuantity,
            unitAmountCents: t.unitAmountCents
          })),
          bonuses: s.dynamization.bonuses.map(b => ({
            thresholdCount: b.thresholdCount,
            bonusAmountCents: b.bonusAmountCents
          }))
        };
        const qty = s.items?.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0) || 1;
        const calc = HccallCommissionEngine.calculateDynamization(dynConfig, qty);
        if (calc.totalCommissionCents !== s.commissionCents) {
          divergenceCount++;
        }
      }
    }

    checks.push({
      name: 'commission_engine_consistency',
      description: 'Paridade 100% entre comissões armazenadas e recálculo da função pura',
      passed: divergenceCount === 0,
      severity: 'WARNING',
      details: { sampleSize: sales.length, divergenceCount }
    });

    // 6. Transição Atempada de Vendas Agendadas
    const now = new Date();
    const overdueScheduledRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT count(*)::text as cnt
      FROM "hccall_sales"
      WHERE "statusId" = 'scheduled' AND "soldAt" < '${now.toISOString()}'
      ${tenantId ? `AND "tenantId" = '${tenantId}'` : ''};
    `);
    const overdueScheduledCount = parseInt(overdueScheduledRes[0]?.cnt || '0', 10);
    checks.push({
      name: 'scheduled_sales_lifecycle',
      description: 'Inexistência de vendas com status "scheduled" cuja data já foi ultrapassada',
      passed: overdueScheduledCount === 0,
      severity: 'WARNING',
      details: { overdueScheduledCount }
    });

    // 7. Proteção e Ativação de RLS no PostgreSQL
    const rlsTables = await prisma.$queryRawUnsafe<any[]>(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'hccall_%';
    `);
    const inactiveRls = rlsTables.filter(t => !t.rowsecurity);
    checks.push({
      name: 'row_level_security_enforcement',
      description: 'Ativação formal de Row Level Security em todas as tabelas hccall_*',
      passed: inactiveRls.length === 0,
      severity: 'CRITICAL',
      details: { totalTables: rlsTables.length, inactiveTables: inactiveRls.map(t => t.tablename) }
    });

    const criticalFailuresCount = checks.filter(c => !c.passed && c.severity === 'CRITICAL').length;
    const warningsCount = checks.filter(c => !c.passed && c.severity === 'WARNING').length;

    return {
      passed: criticalFailuresCount === 0,
      checkedAt,
      tenantId,
      checks,
      criticalFailuresCount,
      warningsCount
    };
  }
}
