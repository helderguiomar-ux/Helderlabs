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

  /**
   * Grava um registo de auditoria com encadeamento de hash SHA-256 canónico.
   *
   * A serialização era feita por uma fila em memória (`partitionQueues: Map`),
   * que funciona num processo único e NÃO funciona em serverless: no Vercel há
   * várias invocações concorrentes, cada uma com o seu próprio Map vazio. Dois
   * pedidos simultâneos liam o mesmo `lastLog`, calculavam o mesmo `prevHash` e
   * gravavam ambos — partindo a cadeia. Foi essa a causa real do alerta de
   * "adulteração em prevHash", não uma intrusão.
   *
   * Passa a usar um advisory lock transacional do PostgreSQL, que serializa a
   * leitura-do-último + escrita entre TODAS as instâncias, e o par
   * @@unique([tenantId, prevHash]) no schema garante que, mesmo que o lock
   * falhe, a colisão é um erro de escrita recuperável e não uma cadeia partida
   * em silêncio.
   */
  private static readonly MAX_WRITE_ATTEMPTS = 3;

  static async audit(input: AuditLogInput): Promise<void> {
    const tenantId = input.tenantId || null;
    const partitionKey = tenantId || '__global__';
    const isSecurity = (input.category || 'APPLICATION') === 'SECURITY';

    let lastError: any = null;

    for (let attempt = 1; attempt <= this.MAX_WRITE_ATTEMPTS; attempt++) {
      try {
        await prisma.$transaction(async (tx: any) => {
          // Serializa a secção crítica por partição, entre instâncias quando suportado.
          try {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partitionKey}))`;
          } catch (lockErr: any) {
            // Em ambientes de pooler restrito ou SQLite, prossegue com garantia da constraint única.
          }

          const lastLog = await tx.auditLog.findFirst({
            where: { tenantId },
            orderBy: { seq: 'desc' },
            select: { hash: true }
          });

          const prevHash = lastLog?.hash || GENESIS_PREV_HASH;
          const timestamp = new Date();

          const computedDiff =
            input.diff || (input.oldValue && input.newValue ? this.computeDiff(input.oldValue, input.newValue) : null);

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

          await tx.auditLog.create({
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
        }, { timeout: 10000, maxWait: 10000 });

        return; // gravado com sucesso
      } catch (err: any) {
        lastError = err;
        // P2002 / P2028 / timeout: colisão na constraint única ou timeout transitório do pool.
        // Volta a tentar com backoff exponencial.
        const isRetryable =
          err?.code === 'P2002' ||
          err?.code === 'P2028' ||
          err?.message?.includes('timeout') ||
          err?.message?.includes('connection');
        if (!isRetryable || attempt === this.MAX_WRITE_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, 35 * attempt));
      }
    }

    // -----------------------------------------------------------------------
    // A falha de auditoria deixa de ser silenciosa.
    // Em categoria SECURITY, propaga-se e aborta a operação de negócio: uma
    // ação sensível não pode concluir-se sem rasto. Nas restantes, regista-se
    // de forma observável, sem derrubar o pedido.
    // -----------------------------------------------------------------------
    console.error('[AUDIT FAILURE]', {
      action: input.action,
      category: input.category,
      tenantId,
      attempts: this.MAX_WRITE_ATTEMPTS,
      error: lastError?.message || String(lastError)
    });

    if (isSecurity) {
      throw new Error(
        `AUDIT_WRITE_FAILED: não foi possível registar o evento de segurança '${input.action}'. Operação abortada.`
      );
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
  public static async verifyAuditChainForPartition(
    partitionTenantId: string | null
  ): Promise<{
    valid: boolean;
    totalLogs: number;
    invalidAtId?: string;
    reason?: string;
    resealed?: boolean;
    resealedAt?: Date | null;
    resealedBy?: string | null;
    resealedCount?: number;
    documentedBreaks?: number;
    undocumentedBreakAt?: string;
    statement?: string;
  }> {
    // Verificação por LOTES com cursor sobre `seq`. Antes carregava a partição
    // inteira em memória (`findMany` sem paginação) e era invocada pelo painel
    // de auditoria a cada abertura — com volume, bloqueia o event-loop.
    // Descontinuidades já documentadas e classificadas. Existem porque a
    // serialização em memória não funcionava em serverless; foram preservadas
    // de propósito — apagá-las apagaria a prova de que o defeito era real.
    // A verificação passa a distingui-las de uma adulteração, em vez de as
    // confundir num único "cadeia partida".
    const incidents: any[] = await prisma.auditChainIncident
      .findMany({ where: { tenantId: partitionTenantId } })
      .catch(() => [] as any[]);
    const documented = new Map<string, any>(incidents.map((i) => [i.prevHash, i]));

    const BATCH = 500;
    let cursorSeq: bigint | null = null;
    let expectedPrevHash = GENESIS_PREV_HASH;
    let total = 0;
    let isFirst = true;

    let resealedCount = 0;
    let lastResealAt: Date | null = null;
    let lastResealBy: string | null = null;
    let documentedBreaks = 0;

    for (;;) {
      const logs: any[] = await prisma.auditLog.findMany({
        where: {
          tenantId: partitionTenantId,
          ...(cursorSeq !== null ? { seq: { gt: cursorSeq } } : {})
        },
        orderBy: { seq: 'asc' },
        take: BATCH
      });

      if (logs.length === 0) break;

      for (const log of logs) {
        total++;

        if (log.resealedAt) {
          resealedCount++;
          if (!lastResealAt || log.resealedAt > lastResealAt) {
            lastResealAt = log.resealedAt;
            lastResealBy = log.resealedBy ?? null;
          }
        }

        const isGenesis = isFirst && (log.prevHash === '' || log.prevHash === GENESIS_PREV_HASH);
        if (!isGenesis && log.prevHash !== expectedPrevHash) {
          const incident = documented.get(log.prevHash);

          if (incident && incident.classification === 'CONCURRENCY_RACE') {
            // Descontinuidade conhecida: reancora-se e prossegue. A integridade
            // do CONTEÚDO de cada registo continua a ser verificada por hash,
            // logo a seguir, sem exceção — o que está documentado é o elo, não
            // o conteúdo.
            documentedBreaks++;
          } else {
            return {
              valid: false,
              totalLogs: total,
              invalidAtId: log.id,
              undocumentedBreakAt: log.seq.toString(),
              reason: `Descontinuidade NÃO documentada em prevHash na linha seq=${log.seq.toString()} (esperado: ${expectedPrevHash}, obtido: ${log.prevHash})`,
              resealed: resealedCount > 0,
              resealedAt: lastResealAt,
              resealedBy: lastResealBy,
              resealedCount,
              documentedBreaks
            };
          }
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
          prevHash: log.prevHash
        });

        const computedHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

        // O fallback para o payload legado (JSON.stringify) foi removido:
        // aceitar dois formatos de digest significa ter duas definições de
        // "íntegro" — ou seja, nenhuma.
        if (log.hash !== computedHash) {
          return {
            valid: false,
            totalLogs: total,
            invalidAtId: log.id,
            reason: `Adulteração de payload detetada na linha seq=${log.seq.toString()}`,
            resealed: resealedCount > 0,
            resealedAt: lastResealAt,
            resealedBy: lastResealBy,
            resealedCount,
            documentedBreaks
          };
        }

        expectedPrevHash = log.hash;
        isFirst = false;
        cursorSeq = log.seq;
      }

      if (logs.length < BATCH) break;
    }

    // Nem uma partição re-selada nem uma com descontinuidades documentadas
    // voltam a devolver um simples "íntegra".
    const parts: string[] = [];
    if (documentedBreaks > 0) {
      parts.push(
        `${documentedBreaks} descontinuidade(s) documentada(s) por corrida de escrita anterior à v1.1.0 (elo partido, conteúdo íntegro)`
      );
    }
    if (resealedCount > 0) {
      parts.push(
        `re-selagem de ${resealedCount} registo(s) em ${lastResealAt ? lastResealAt.toISOString() : 'data desconhecida'} por ${lastResealBy || 'ator desconhecido'} — a integridade anterior a essa data não é verificável`
      );
    }

    const statement =
      parts.length === 0
        ? 'Íntegra desde a génese.'
        : `Conteúdo de todos os ${total} registos verificado por hash. ${parts.join('; ')}.`;

    return {
      valid: true,
      totalLogs: total,
      resealed: resealedCount > 0,
      resealedAt: lastResealAt,
      resealedBy: lastResealBy,
      resealedCount,
      documentedBreaks,
      statement
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
  static async repairChain(
    tenantId: string | null,
    reason: string,
    superAdminId: string
  ): Promise<{ repairedCount: number; batchId: string }> {
    // -----------------------------------------------------------------------
    // Re-selagem canónica da cadeia — decisão D2.
    //
    // Mantém-se como ferramenta de recuperação operacional, mas deixa de poder
    // ser usada em silêncio. Uma cadeia que o administrador pode reescrever não
    // prova nada contra o administrador; o que se garante agora é que a
    // reescrita fica permanentemente visível:
    //   1. o estado anterior é guardado INTEGRALMENTE (não 5 amostras);
    //   2. cada registo reescrito fica marcado para sempre;
    //   3. o motivo é obrigatório;
    //   4. verifyAuditChain deixa de devolver "íntegra" sem qualificação.
    // -----------------------------------------------------------------------
    const trimmedReason = (reason || '').trim();
    if (trimmedReason.length < 20) {
      throw new Error(
        'CHAIN_REPAIR_REASON_REQUIRED: é obrigatório indicar um motivo com pelo menos 20 caracteres para re-selar a cadeia de auditoria.'
      );
    }
    if (!superAdminId) {
      throw new Error('CHAIN_REPAIR_ACTOR_REQUIRED: a re-selagem exige a identificação do ator.');
    }

    const batchId = crypto.randomUUID();
    const performedAt = new Date();

    const logs: any[] = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { seq: 'asc' },
      select: { id: true, seq: true, prevHash: true, hash: true, actorId: true, onBehalfOfId: true,
                tenantId: true, action: true, resource: true, resourceId: true,
                oldValue: true, newValue: true, timestamp: true }
    });

    // Estado anterior INTEGRAL, gravado antes de qualquer escrita.
    const previousState = logs.map((l) => ({
      id: l.id,
      seq: l.seq.toString(),
      prevHash: l.prevHash,
      hash: l.hash
    }));

    let currentPrevHash = GENESIS_PREV_HASH;
    let repairedCount = 0;

    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId || '__global__'}))`;

      for (const log of logs) {
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

        await tx.auditLog.update({
          where: { id: log.id },
          data: {
            prevHash: currentPrevHash,
            hash: newHash,
            resealedAt: performedAt,
            resealedBy: superAdminId,
            resealBatchId: batchId
          }
        });

        currentPrevHash = newHash;
        repairedCount++;
      }

      await tx.auditChainReseal.create({
        data: {
          batchId,
          tenantId,
          reason: trimmedReason,
          performedBy: superAdminId,
          performedAt,
          affectedCount: repairedCount,
          previousState: previousState as any,
          finalHash: currentPrevHash
        }
      });
    });

    await this.audit({
      actorId: superAdminId,
      actorType: 'SUPER_ADMIN',
      tenantId: tenantId || undefined,
      action: 'CHAIN_REPAIR',
      category: 'SECURITY',
      resource: 'AuditChain',
      resourceId: batchId,
      description: `Re-selagem canónica da cadeia criptográfica: ${trimmedReason}`,
      newValue: {
        batchId,
        repairedCount,
        finalHash: currentPrevHash,
        performedAt: performedAt.toISOString()
      },
      result: 'SUCCESS'
    });

    return { repairedCount, batchId };
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
