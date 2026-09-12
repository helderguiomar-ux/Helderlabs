/**
 * TESTE DE CONCORRÊNCIA DA CADEIA DE AUDITORIA — regressão AUD-01.
 *
 * A serialização era feita por uma fila em memória do processo. Num único
 * processo de node:test essa fila funciona sempre — e foi por isso que o
 * defeito nunca apareceu em testes, só em produção (Vercel, multi-instância).
 *
 * Este teste escreve em paralelo e verifica a cadeia. Com o advisory lock
 * transacional + índice único do elo, passa; com a fila em memória, o índice
 * único faz a colisão aparecer em vez de a esconder.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../../src/modules/platform/services/AuditService';
import { prisma } from '../../src/database/prisma/client';

describe('Cadeia de auditoria sob concorrência', () => {
  const tenantId = `audit_conc_${Date.now()}`;

  before(async () => {
    await prisma.tenant.create({
      data: { id: tenantId, name: 'Tenant Concorrência', slug: `tenant-conc-${Date.now()}`, status: 'ACTIVE' }
    });
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('mantém a cadeia íntegra com 50 escritas em paralelo', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        AuditService.audit({
          action: `concorrencia.escrita.${i}`,
          category: 'APPLICATION',
          tenantId,
          resource: 'TesteConcorrencia',
          resourceId: String(i),
          newValue: { i },
          result: 'SUCCESS'
        })
      )
    );

    const total = await prisma.auditLog.count({ where: { tenantId } });
    assert.strictEqual(total, 50, 'nenhuma escrita se pode perder');

    const result = await AuditService.verifyAuditChainForPartition(tenantId);
    assert.strictEqual(result.valid, true, `cadeia partida: ${result.reason ?? ''}`);
    assert.strictEqual(result.totalLogs, 50);
  });

  it('repairChain exige motivo e deixa marca permanente (decisão D2)', async () => {
    await assert.rejects(
      () => AuditService.repairChain(tenantId, 'curto', 'super-admin-teste'),
      /CHAIN_REPAIR_REASON_REQUIRED/,
      'um motivo com menos de 20 caracteres tem de ser recusado'
    );

    const { repairedCount, batchId } = await AuditService.repairChain(
      tenantId,
      'Teste de re-selagem com motivo suficientemente descritivo para o requisito.',
      'super-admin-teste'
    );
    assert.ok(repairedCount > 0);

    const snapshot = await prisma.auditChainReseal.findUnique({ where: { batchId } });
    assert.ok(snapshot, 'o estado anterior tem de ficar guardado na íntegra');
    assert.strictEqual((snapshot!.previousState as any[]).length, repairedCount);

    const verified = await AuditService.verifyAuditChainForPartition(tenantId);
    assert.strictEqual(verified.resealed, true);
    assert.ok(
      verified.statement?.includes('re-selagem'),
      'a verificação não pode voltar a devolver um simples "íntegra" numa partição re-selada'
    );
  });
});
