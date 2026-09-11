import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import jwt from 'jsonwebtoken';

describe('Bloco 0.2 — Auditoria Transversal Estrutural & Reflexão de Rotas', () => {
  let app: any;
  const tenantId = `audit_refl_tenant_${Date.now()}`;
  let token: string;
  let user: any;

  before(async () => {
    app = await buildApp();
    await app.ready();

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Tenant de Teste de Reflexão',
        slug: `tenant-refl-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    user = await prisma.user.create({
      data: {
        tenantId,
        email: `refl.user.${Date.now()}@helderlabs.eu`,
        name: 'Utilizador Reflexão',
        passwordHash: 'fake_hash',
        role: 'SUPER_ADMIN'
      }
    });

    let modHccall = await prisma.module.findUnique({ where: { key: 'hccall' } });
    if (!modHccall) {
      modHccall = await prisma.module.create({
        data: { key: 'hccall', name: 'HCCALL', isActive: true }
      });
    }

    const appInst = await prisma.applicationInstance.create({
      data: { moduleId: modHccall.id, tenantId, status: 'ACTIVE' }
    });

    await prisma.applicationAssignment.create({
      data: { userId: user.id, applicationId: appInst.id, roleInApp: 'ADMIN', status: 'ACTIVE' }
    });

    const secret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: user.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.hccallOrgContext.deleteMany({ where: { tenantId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  });

  it('1. Teste por Reflexão: Todas as mutações HTTP registam log estruturalmente', async () => {
    // 1. Contar logs de auditoria antes da mutação
    const beforeCount = await prisma.auditLog.count({ where: { tenantId } });

    // 2. Executar pedido de mutação (ex: POST /api/hccall/context/switch)
    const res = await app.inject({
      method: 'POST',
      url: '/api/hccall/context/switch',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        companyName: 'HelderLabs Audit Corp',
        workplace: 'Lisboa',
        jobRole: 'Auditor de Sistema'
      }
    });

    assert.ok([200, 201].includes(res.statusCode), `Status deve ser sucesso, obtido: ${res.statusCode}`);

    // 3. Verificar que o log de auditoria foi gerado com todos os metadados
    const afterLogs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { seq: 'desc' },
      take: 5
    });

    assert.ok(afterLogs.length > beforeCount, 'A mutação DEVE gerar registo de auditoria automaticamente no hook');
    
    const latestLog = afterLogs[0];
    assert.equal(latestLog.actorId, user.id);
    assert.equal(latestLog.actorEmail, user.email);
    assert.equal(latestLog.actorType, 'SUPER_ADMIN');
    assert.equal(latestLog.tenantId, tenantId);
    assert.ok(latestLog.hash && latestLog.hash.length === 64, 'Hash SHA-256 deve estar presente e válido');
  });

  it('2. Interceção de Falhas de Autorização (Categoria SECURITY)', async () => {
    // Fazer pedido sem permissão com token inválido ou utilizador sem permissão
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/tenants',
      headers: { authorization: 'Bearer invalid_token' },
      payload: { name: 'Tenant Invasor' }
    });

    assert.equal(res.statusCode, 401);

    // O hook deve registar a tentativa falhada de segurança
    const securityLogs = await prisma.auditLog.findMany({
      where: { category: 'SECURITY', result: 'FAILURE' },
      orderBy: { seq: 'desc' },
      take: 1
    });

    assert.ok(securityLogs.length > 0, 'Falha de segurança DEVE ser auditada com category=SECURITY');
  });
});
