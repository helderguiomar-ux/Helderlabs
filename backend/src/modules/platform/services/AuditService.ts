import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';
import { CanonicalJson } from './CanonicalJson';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export type AuditLogInput = {
  action: string;
  module?: string;
  category?: 'SYSTEM' | 'APPLICATION' | 'SECURITY' | 'DATABASE' | 'API' | 'USER';
  resource?: string;
  resourceId?: string;
  description?: string;
  oldValue?: any;
  newValue?: any;
  diff?: any;
  result?: string;
  tenantId?: string;
  actorId?: string;
  actorEmail?: string;
  actorType?: 'USER' | 'SUPER_ADMIN' | 'SYSTEM';
  onBehalfOfId?: string;
  impersonationId?: string;
  sessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export class AuditService {
  /**
   * Helper to compute JSON diff between oldValue and newValue
   */
  static computeDiff(oldVal: any, newVal: any): any {
    if (!oldVal && !newVal) return null;
    if (!oldVal || !newVal || typeof oldVal !== 'object' || typeof newVal !== 'object') {
      return { before: oldVal, after: newVal };
    }
    const diff: Record<string, { before: any; after: any }> = {};
    const allKeys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    for (const key of allKeys) {
      if (key === 'updatedAt' || key === 'createdAt' || key === 'passwordHash') continue;
      if (CanonicalJson.stringify(oldVal[key]) !== CanonicalJson.stringify(newVal[key])) {
        diff[key] = { before: oldVal[key], after: newVal[key] };
      }
    }
    return Object.keys(diff).length > 0 ? diff : null;
  }

  /**
   * Gera o digest canónico em string com ordenação e formatação determinística
   */
  public static computeCanonicalDigest(fields: {
    actorId?: string | null;
    onBehalfOfId?: string | null;
    tenantId?: string | null;
    action: string;
    resource?: string | null;
    resourceId?: string | null;
    oldValue?: any;
    newValue?: any;
    timestamp: Date;
    prevHash: string;
  }): string {
    return [
      fields.actorId || '',
      fields.onBehalfOfId || '',
      fields.tenantId || '',
      fields.action,
      fields.resource || '',
      fields.resourceId || '',
      CanonicalJson.stringify(fields.oldValue ?? null),
      CanonicalJson.stringify(fields.newValue ?? null),
      fields.timestamp.toISOString(),
      fields.prevHash
    ].join('|');
  }

  private static partitionQueues: Map<string, Promise<any>> = new Map();

  /**
   * Grava um registo de auditoria com encadeamento de hash SHA-256 canónico e computação de diff
   * Garante atomicidade e sequenciação estrita de hashes por partição (tenant ou global).
   */
  static async audit(input: AuditLogInput): Promise<void> {
    const partitionKey = input.tenantId || '__global__';
    const previousPromise = this.partitionQueues.get(partitionKey) || Promise.resolve();

    const writeTask = async () => {
      try {
        const tenantId = input.tenantId || null;

        // Obter o último registo desta partição (tenant ou global) para obter prevHash
        const lastLog = await prisma.auditLog.findFirst({
          where: { tenantId },
          orderBy: { seq: 'desc' }
        });

        const prevHash = lastLog?.hash || GENESIS_PREV_HASH;
        const timestamp = new Date();

        const computedDiff = input.diff || (input.oldValue && input.newValue ? this.computeDiff(input.oldValue, input.newValue) : null);

        const canonicalPayload = this.computeCanonicalDigest({
          actorId: input.actorId,
          onBehalfOfId: input.onBehalfOfId,
          tenantId,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          oldValue: input.oldValue,
          newValue: input.newValue,
          timestamp,
          prevHash
        });

        const hash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

        await prisma.auditLog.create({
          data: {
            actorId: input.actorId || null,
            actorEmail: input.actorEmail || null,
            actorType: input.actorType || 'USER',
            onBehalfOfId: input.onBehalfOfId || null,
            impersonationId: input.impersonationId || null,
            sessionId: input.sessionId || null,
            tenantId,
            module: input.module || null,
            category: input.category || 'APPLICATION',
            action: input.action,
            resource: input.resource || null,
            resourceId: input.resourceId || null,
            description: input.description || null,
            oldValue: input.oldValue ? (input.oldValue as any) : null,
            newValue: input.newValue ? (input.newValue as any) : null,
            diff: computedDiff ? (computedDiff as any) : null,
            result: input.result || 'SUCCESS',
            requestId: input.requestId || null,
            ipAddress: input.ipAddress || null,
            userAgent: input.userAgent || null,
            timestamp,
            prevHash,
            hash
          }
        });
      } catch (err: any) {
        console.error('[AUDIT ERROR] Falha ao gravar registo de auditoria:', err.message || err);
      }
    };

    const currentPromise = previousPromise.then(writeTask, writeTask);
    this.partitionQueues.set(partitionKey, currentPromise);

    await currentPromise;
  }

  /**
   * List logs with filtering and pagination
   */
  static async listLogs(filters: {
    tenantId?: string;
    module?: string;
    category?: string;
    action?: string;
    actorId?: string;
    resource?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.module) where.module = filters.module;
    if (filters.category) where.category = filters.category;
    if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.resource) where.resource = filters.resource;
    if (filters.resourceId) where.resourceId = filters.resourceId;
    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = filters.startDate;
      if (filters.endDate) where.timestamp.lte = filters.endDate;
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const [total, rawLogs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset
      })
    ]);

    const logs = rawLogs.map(l => ({
      ...l,
      seq: typeof l.seq === 'bigint' ? Number(l.seq) : l.seq
    }));

    return { total, limit, offset, logs };
  }

  /**
   * Get audit history for a specific entity (e.g. company, transaction, lead)
   */
  static async getResourceTimeline(resource: string, resourceId: string, tenantId?: string) {
    const rawLogs = await prisma.auditLog.findMany({
      where: {
        resource,
        resourceId,
        ...(tenantId && { tenantId })
      },
      orderBy: { timestamp: 'desc' },
      take: 100
    });

    return rawLogs.map(l => ({
      ...l,
      seq: typeof l.seq === 'bigint' ? Number(l.seq) : l.seq
    }));
  }

  /**
   * Verifica a integridade da cadeia de hashes para uma partição específica (tenant ou global)
   */
  public static async verifyAuditChainForPartition(partitionTenantId: string | null): Promise<{ valid: boolean; totalLogs: number; invalidAtId?: string; reason?: string }> {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: partitionTenantId },
      orderBy: { seq: 'asc' }
    });

    if (logs.length === 0) {
      return { valid: true, totalLogs: 0 };
    }

    let expectedPrevHash = GENESIS_PREV_HASH;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      // Suporte para génese (64 zeros ou string vazia legada no primeiro registo)
      const isGenesis = (i === 0) && (log.prevHash === '' || log.prevHash === GENESIS_PREV_HASH);
      if (!isGenesis && log.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          totalLogs: logs.length,
          invalidAtId: log.id,
          reason: `Adulteração detetada em prevHash na linha seq=${log.seq.toString()} (Esperado: ${expectedPrevHash}, Obtido: ${log.prevHash})`
        };
      }

      const canonicalPayload = this.computeCanonicalDigest({
        actorId: log.actorId,
        onBehalfOfId: log.onBehalfOfId,
        tenantId: log.tenantId,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        oldValue: log.oldValue,
        newValue: log.newValue,
        timestamp: log.timestamp,
        prevHash: log.prevHash || (i === 0 ? '' : expectedPrevHash)
      });

      const computedHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

      // Tentar tanto com prevHash exato como com o computedPayload
      if (log.hash !== computedHash) {
        // Testar fallback para payload legado se for registo antigo
        const legacyPayload = [
          log.actorId || '',
          log.onBehalfOfId || '',
          log.tenantId || '',
          log.action,
          log.resource || '',
          log.resourceId || '',
          JSON.stringify(log.oldValue || null),
          JSON.stringify(log.newValue || null),
          log.timestamp.toISOString(),
          log.prevHash || ''
        ].join('|');
        const legacyHash = crypto.createHash('sha256').update(legacyPayload).digest('hex');

        if (log.hash !== legacyHash) {
          return {
            valid: false,
            totalLogs: logs.length,
            invalidAtId: log.id,
            reason: `Adulteração de payload detetada na linha seq=${log.seq.toString()}`
          };
        }
      }

      expectedPrevHash = log.hash;
    }

    return {
      valid: true,
      totalLogs: logs.length
    };
  }

  /**
   * Verifica a integridade da cadeia de hashes para todos os tenants e partição global
   */
  static async verifyAuditChain(tenantId?: string): Promise<{ valid: boolean; totalLogs: number; invalidAtId?: string; reason?: string }> {
    if (tenantId === undefined) {
      const tenants = await prisma.tenant.findMany({ select: { id: true } });
      let total = 0;

      // Verificar partição global
      const globalRes = await this.verifyAuditChainForPartition(null);
      if (!globalRes.valid) return globalRes;
      total += globalRes.totalLogs;

      // Verificar cada tenant
      for (const t of tenants) {
        const res = await this.verifyAuditChainForPartition(t.id);
        if (!res.valid) return res;
        total += res.totalLogs;
      }
      return { valid: true, totalLogs: total };
    }

    return this.verifyAuditChainForPartition(tenantId);
  }

  /**
   * Re-sela canonicamente a cadeia de um tenant gerando obrigatoriamente um evento auditável CHAIN_REPAIR
   */
  static async repairChain(tenantId: string | null, reason: string, superAdminId: string): Promise<{ repairedCount: number }> {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { seq: 'asc' }
    });

    let currentPrevHash = GENESIS_PREV_HASH;
    let repairedCount = 0;
    const oldHashes: Record<string, string> = {};

    for (const log of logs) {
      oldHashes[log.id] = log.hash || '';
      const canonicalPayload = this.computeCanonicalDigest({
        actorId: log.actorId,
        onBehalfOfId: log.onBehalfOfId,
        tenantId: log.tenantId,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        oldValue: log.oldValue,
        newValue: log.newValue,
        timestamp: log.timestamp,
        prevHash: currentPrevHash
      });

      const newHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

      await prisma.auditLog.update({
        where: { id: log.id },
        data: {
          prevHash: currentPrevHash,
          hash: newHash
        }
      });

      currentPrevHash = newHash;
      repairedCount++;
    }

    // Gravar evento formal CHAIN_REPAIR
    await this.audit({
      actorId: superAdminId,
      actorType: 'SUPER_ADMIN',
      tenantId: tenantId || undefined,
      action: 'CHAIN_REPAIR',
      resource: 'AuditChain',
      description: `Re-selagem canónica da cadeia criptográfica: ${reason}`,
      oldValue: { repairedCount, sampleOldHashes: Object.entries(oldHashes).slice(0, 5) },
      newValue: { status: 'SEALED_CANONICAL', finalHash: currentPrevHash, timestamp: new Date().toISOString() },
      result: 'SUCCESS'
    });

    return { repairedCount };
  }

  /**
   * Dashboard metrics for platform/audit control plane
   */
  static async getDashboardMetrics(tenantId?: string) {
    const where = tenantId ? { tenantId } : {};

    const [totalLogs, securityLogs, integrity, moduleStats] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.count({ where: { ...where, category: 'SECURITY' } }),
      this.verifyAuditChain(tenantId),
      prisma.auditLog.groupBy({
        by: ['module'],
        where,
        _count: { _all: true }
      })
    ]);

    return {
      totalLogs,
      securityLogs,
      integrity,
      moduleStats: moduleStats.map((s) => ({ module: s.module || 'geral', count: s._count._all }))
    };
  }
}
