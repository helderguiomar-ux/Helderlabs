import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../../src/modules/platform/services/AuditService';
import { prisma } from '../../src/database/prisma/client';

describe('Phase 6 Audit Logging & Hash Chain Integrity', () => {
  test('AuditService grava logs com encadeamento de hash SHA-256 válido', async () => {
    const tenant = await prisma.tenant.findFirst();
    assert.ok(tenant);

    await AuditService.audit({
      action: 'test.action.1',
      resource: 'test_resource',
      tenantId: tenant.id,
      actorEmail: 'admin@test.com'
    });

    await AuditService.audit({
      action: 'test.action.2',
      resource: 'test_resource',
      tenantId: tenant.id,
      actorEmail: 'admin@test.com'
    });

    const verification = await AuditService.verifyAuditChain(tenant.id);
    assert.equal(verification.valid, true);
    assert.ok(verification.totalLogs >= 2);
  });

  test('Adulteração na cadeia de auditoria é detetada pelo verifyAuditChain', async () => {
    const tenant = await prisma.tenant.findFirst();
    assert.ok(tenant);

    const logToTamper = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { seq: 'desc' }
    });
    assert.ok(logToTamper);

    const originalHash = logToTamper.hash;

    // Tamper hash
    await prisma.auditLog.update({
      where: { id: logToTamper.id },
      data: { hash: 'tampered_hash_value_12345' }
    });

    const verification = await AuditService.verifyAuditChain(tenant.id);
    assert.equal(verification.valid, false);
    assert.equal(verification.invalidAtId, logToTamper.id);

    // Restaurar original
    await prisma.auditLog.update({
      where: { id: logToTamper.id },
      data: { hash: originalHash }
    });
  });
});
