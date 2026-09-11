import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../../src/database/prisma/client';
import { CanonicalJson } from '../../src/modules/platform/services/CanonicalJson';
import { AuditService } from '../../src/modules/platform/services/AuditService';

describe('Bloco 0.1 — Cadeia Criptográfica SHA-256 & Serialização Canónica', () => {
  const tenantId = `audit_chain_tenant_${Date.now()}`;

  before(async () => {
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Tenant de Teste Cadeia Criptográfica',
        slug: `tenant-audit-${Date.now()}`,
        status: 'ACTIVE'
      }
    });
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });

  it('1. Vetor de Teste Fixo 1: Serialização Canónica e Hash Estático Imutável', () => {
    const inputA = {
      z: 'último',
      a: 12345,
      m: { d: 'dentro', c: 99, b: [3, 2, 1] },
      n: null,
      b: true
    };

    const inputB = {
      b: true,
      n: null,
      m: { b: [3, 2, 1], c: 99, d: 'dentro' },
      a: 12345,
      z: 'último'
    };

    const canonicalA = CanonicalJson.stringify(inputA);
    const canonicalB = CanonicalJson.stringify(inputB);

    assert.equal(canonicalA, canonicalB, 'Objetos com chaves em ordens diferentes DEVEM produzir a mesma string canónica');

    const expectedCanonicalString = '{"a":12345,"b":true,"m":{"b":[3,2,1],"c":99,"d":"dentro"},"n":null,"z":"último"}';
    assert.equal(canonicalA, expectedCanonicalString);

    const hashA = crypto.createHash('sha256').update(canonicalA).digest('hex');
    const expectedHash = '3737df21134291d6c841ebaefc78ca3948b4021b2fd66829840f2f1cfe9483a9';
    assert.equal(hashA, expectedHash, 'O hash do vetor de teste estático deve ser 100% determinístico e permanente');
  });

  it('2. Vetor de Teste Fixo 2: Digest Canónico de Registo de Auditoria', () => {
    const digest = AuditService.computeCanonicalDigest({
      actorId: 'usr_123',
      onBehalfOfId: null,
      tenantId: 'tnt_abc',
      action: 'sale.create',
      resource: 'Sale',
      resourceId: 'vnd_001',
      oldValue: null,
      newValue: { code: 'VND-2026-0001', valueCents: 4500, customer: { id: 'c1', name: 'Ana' } },
      timestamp: new Date('2026-09-11T00:00:00.000Z'),
      prevHash: '0000000000000000000000000000000000000000000000000000000000000000'
    });

    const expectedDigest = 'usr_123||tnt_abc|sale.create|Sale|vnd_001|null|{"code":"VND-2026-0001","customer":{"id":"c1","name":"Ana"},"valueCents":4500}|2026-09-11T00:00:00.000Z|0000000000000000000000000000000000000000000000000000000000000000';
    assert.equal(digest, expectedDigest);

    const hash = crypto.createHash('sha256').update(digest).digest('hex');
    assert.equal(hash.length, 64);
  });

  it('3. Gravação em BD, Leitura e Verificação sem Falsos Positivos de jsonb', async () => {
    // Gravar 3 registos em sequência
    await AuditService.audit({
      tenantId,
      actorId: 'usr_test',
      action: 'item.create',
      resource: 'Item',
      resourceId: 'item_1',
      newValue: { title: 'Mesa de Nogueira', priceCents: 15000, attributes: { wood: 'walnut', year: 1890 } }
    });

    await AuditService.audit({
      tenantId,
      actorId: 'usr_test',
      action: 'item.update',
      resource: 'Item',
      resourceId: 'item_1',
      oldValue: { title: 'Mesa de Nogueira', priceCents: 15000, attributes: { wood: 'walnut', year: 1890 } },
      newValue: { title: 'Mesa de Nogueira Sec. XIX', priceCents: 17500, attributes: { year: 1890, wood: 'walnut' } }
    });

    await AuditService.audit({
      tenantId,
      actorId: 'usr_test',
      action: 'item.sell',
      resource: 'Item',
      resourceId: 'item_1',
      newValue: { sold: true, salePriceCents: 17500 }
    });

    const verification = await AuditService.verifyAuditChain(tenantId);
    assert.equal(verification.valid, true, `Cadeia deve ser 100% válida. Motivo de falha se houver: ${verification.reason}`);
    assert.equal(verification.totalLogs, 3);
  });

  it('4. Deteção de Adulteração Direta em Base de Dados (Anti-Tampering)', async () => {
    // Obter o segundo registo deste tenant
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { seq: 'asc' }
    });
    assert.equal(logs.length, 3);

    const targetLog = logs[1];

    // Simular ataque SQL direto: alterar o valor de priceCents de 17500 para 5000 no newValue
    await prisma.$executeRawUnsafe(
      `UPDATE "audit_logs" SET "newValue" = '{"title":"Mesa de Nogueira Sec. XIX","priceCents":5000,"attributes":{"wood":"walnut","year":1890}}'::jsonb WHERE "id" = $1`,
      targetLog.id
    );

    // O verificador TEM de apanhar imediatamente a adulteração no payload
    const tamperedVerification = await AuditService.verifyAuditChain(tenantId);
    assert.equal(tamperedVerification.valid, false, 'Adulteração em base de dados TEM de ser detetada');
    assert.equal(tamperedVerification.invalidAtId, targetLog.id);
    assert.ok(tamperedVerification.reason?.includes('Adulteração'), 'Motivo deve identificar adulteração explicitamente');
  });
});
