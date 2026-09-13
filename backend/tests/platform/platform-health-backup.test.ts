import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/database/prisma/client';
import { PlatformBackupService } from '../../src/modules/platform/services/PlatformBackupService';
import { PlatformHealthService } from '../../src/modules/platform/services/PlatformHealthService';
import { HccallProductService } from '../../src/modules/hccall/services/HccallProductService';

describe('Platform Health, Storage Metrics, Backups & Product Objectives', () => {
  let testTenantId: string;
  let testUserId: string;

  test('Setup: Criar tenant e utilizador para testes', async () => {
    const slug = 'test-health-tenant-' + Date.now();
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Tenant de Teste Health & Backup',
        slug,
        email: `${slug}@helderlabs.eu`,
        status: 'ACTIVE'
      }
    });
    testTenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId: testTenantId,
        name: 'Operador Teste',
        email: `${slug}-user@helderlabs.eu`,
        role: 'USER',
        passwordHash: 'dummy-hash'
      }
    });
    testUserId = user.id;

    assert.ok(testTenantId);
    assert.ok(testUserId);
  });

  test('1. Criação de serviço com meta mensal persiste sem erro P2022', async () => {
    const prod = await HccallProductService.createProduct(
      prisma,
      testTenantId,
      testUserId,
      {
        name: 'Mobile ' + Date.now(),
        category: 'Geral',
        baseValueCents: 1500,
        defaultCommissionCents: 750,
        monthlyTarget: 10
      }
    );

    assert.ok(prod.id);
    assert.equal(prod.name.startsWith('Mobile'), true);
    assert.equal(prod.defaultCommissionCents, 750);
    assert.equal(prod.monthlyTarget, 10);

    // Validar que o objetivo foi criado na BD com productId associado
    const obj = await prisma.hccallObjective.findFirst({
      where: {
        tenantId: testTenantId,
        productId: prod.id,
        deletedAt: null
      }
    });

    assert.ok(obj);
    assert.equal(obj?.productId, prod.id);
    assert.equal(obj?.targetValue, 10);
  });

  test('2. Cópia de segurança de um tenant gera dados estruturados e manifesto SHA-256', async () => {
    const backup = await PlatformBackupService.exportTenantBackup(testTenantId);

    assert.ok(backup.manifest);
    assert.equal(backup.manifest.type, 'TENANT');
    assert.equal(backup.manifest.tenantId, testTenantId);
    assert.ok(backup.manifest.checksum);
    assert.ok(backup.data);
    assert.ok(backup.data['hccall_products'].length > 0);
  });

  test('3. Cópia de segurança global (todos os tenants) gera dump consolidado', async () => {
    const allBackup = await PlatformBackupService.exportAllTenantsBackup();

    assert.ok(allBackup.manifest);
    assert.equal(allBackup.manifest.type, 'ALL_TENANTS');
    assert.ok(allBackup.manifest.totalTenants && allBackup.manifest.totalTenants > 0);
    assert.ok(allBackup.manifest.checksum);
    assert.ok(Array.isArray(allBackup.tenants));
    assert.ok(allBackup.tenants.some(t => t.tenant.id === testTenantId));
  });

  test('4. Métricas de armazenamento calculam espaço e contagens por cliente', async () => {
    const metrics = await PlatformHealthService.getStorageMetrics();

    assert.equal(metrics.success, true);
    assert.ok(metrics.summary.totalTenants > 0);
    assert.ok(metrics.summary.totalStorageFormatted);
    assert.ok(Array.isArray(metrics.tenants));

    const found = metrics.tenants.find(t => t.id === testTenantId);
    assert.ok(found);
    assert.ok(found.totalRows > 0);
    assert.ok(found.storageFormatted);
    assert.ok(found.breakdown.hccall > 0);
  });

  test('5. Auditoria de saúde da base de dados analisa achados sem operações destrutivas', async () => {
    const health = await PlatformHealthService.auditDatabaseHealth();

    assert.equal(health.success, true);
    assert.ok(health.score >= 0 && health.score <= 100);
    assert.ok(Array.isArray(health.findings));
    assert.ok(health.findings.length > 0);

    const pingFinding = health.findings.find(f => f.id === 'DB_CONNECTION_PING');
    assert.ok(pingFinding);
    assert.equal(pingFinding.severity, 'OK');

    const colFinding = health.findings.find(f => f.id === 'COL_OBJECTIVE_PRODUCT_ID');
    assert.ok(colFinding);
    assert.equal(colFinding.severity, 'OK');
  });

  test('Teardown: Limpeza de dados de teste', async () => {
    await prisma.hccallObjective.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.hccallProduct.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.user.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.tenant.delete({ where: { id: testTenantId } });
  });
});
