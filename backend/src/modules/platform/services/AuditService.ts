import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';

export type AuditLogInput = {
  action: string;
  resource?: string;
  resourceId?: string;
  oldValue?: any;
  newValue?: any;
  result?: string;
  tenantId?: string;
  actorId?: string;
  actorEmail?: string;
  actorType?: 'USER' | 'SUPER_ADMIN' | 'SYSTEM';
  onBehalfOfId?: string;
  impersonationId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export class AuditService {
  /**
   * Grava um registo de auditoria com encadeamento de hash SHA-256
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
          tenantId,
          action: input.action,
          resource: input.resource || null,
          resourceId: input.resourceId || null,
          oldValue: input.oldValue ? (input.oldValue as any) : null,
          newValue: input.newValue ? (input.newValue as any) : null,
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
}
