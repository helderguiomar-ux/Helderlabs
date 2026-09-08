import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';

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
      if (JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key])) {
        diff[key] = { before: oldVal[key], after: newVal[key] };
      }
    }
    return Object.keys(diff).length > 0 ? diff : null;
  }

  /**
   * Grava um registo de auditoria com encadeamento de hash SHA-256 e computação automática de diff
   */
  static async audit(input: AuditLogInput): Promise<void> {
    try {
      const tenantId = input.tenantId || null;

      // Obter o último registo deste tenant para obter prevHash
      const lastLog = await prisma.auditLog.findFirst({
        where: tenantId ? { tenantId } : undefined,
        orderBy: { seq: 'desc' }
      });

      const prevHash = lastLog?.hash || '';
      const timestamp = new Date();

      const computedDiff = input.diff || (input.oldValue && input.newValue ? this.computeDiff(input.oldValue, input.newValue) : null);

      const canonicalPayload = [
        input.actorId || '',
        input.onBehalfOfId || '',
        tenantId || '',
        input.action,
        input.resource || '',
        input.resourceId || '',
        JSON.stringify(input.oldValue || null),
        JSON.stringify(input.newValue || null),
        timestamp.toISOString(),
        prevHash
      ].join('|');

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

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset
      })
    ]);

    return { total, limit, offset, logs };
  }

  /**
   * Get audit history for a specific entity (e.g. company, transaction, lead)
   */
  static async getResourceTimeline(resource: string, resourceId: string, tenantId?: string) {
    return prisma.auditLog.findMany({
      where: {
        resource,
        resourceId,
        ...(tenantId && { tenantId })
      },
      orderBy: { timestamp: 'desc' },
      take: 100
    });
  }

  /**
   * Verifica a integridade da cadeia de hashes para um tenant (ou global)
   */
  static async verifyAuditChain(tenantId?: string): Promise<{ valid: boolean; totalLogs: number; invalidAtId?: string; reason?: string }> {
    const logs = await prisma.auditLog.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { seq: 'asc' }
    });

    let expectedPrevHash = '';

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      if (log.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          totalLogs: logs.length,
          invalidAtId: log.id,
          reason: `Adulteração detetada em prevHash na linha seq=${log.seq.toString()}`
        };
      }

      const canonicalPayload = [
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

      const computedHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

      if (log.hash !== computedHash) {
        return {
          valid: false,
          totalLogs: logs.length,
          invalidAtId: log.id,
          reason: `Adulteração de payload detetada na linha seq=${log.seq.toString()}`
        };
      }

      expectedPrevHash = log.hash;
    }

    return {
      valid: true,
      totalLogs: logs.length
    };
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
