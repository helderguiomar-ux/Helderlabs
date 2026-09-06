import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/plugins/authenticate';
import { prisma } from '../../src/database/prisma/client';

describe('Phase 5 Impersonation & Super Admin Control Plane', () => {
  test('Super Admin consegue iniciar sessão de suporte (Impersonation)', async () => {
    const app = buildApp();
    const superAdmin = await prisma.user.findFirst({ where: { email: 'helderguiomar@gmail.com' } });
    const targetTenant = await prisma.tenant.findFirst({ where: { slug: 'consultoria-alfa' } });
    assert.ok(superAdmin && targetTenant);

    const token = signAuthToken({
      sub: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
      tenantId: superAdmin.tenantId
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/impersonate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        targetTenantId: targetTenant.id,
        reason: 'Investigação de suporte técnico a pedido do cliente',
        writeEnabled: false
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.ok(body.token);
    assert.ok(body.session.id);
    await app.close();
  });

  test('Sessão de suporte em modo só leitura rejeita escrita com 403 IMPERSONATION_READ_ONLY', async () => {
    const app = buildApp();
    const superAdmin = await prisma.user.findFirst({ where: { email: 'helderguiomar@gmail.com' } });
    const targetTenant = await prisma.tenant.findFirst({ where: { slug: 'consultoria-alfa' } });
    assert.ok(superAdmin && targetTenant);

    const impToken = signAuthToken({
      sub: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
      tenantId: targetTenant.id,
      aud: 'tenant',
      impersonationId: 'imp_test_session',
      actingTenantId: targetTenant.id,
      writeEnabled: false
    }, '30m');

    // GET deve passar
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/crm/leads',
      headers: { authorization: `Bearer ${impToken}` }
    });
    assert.equal(getRes.statusCode, 200);

    // POST deve ser bloqueado
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/crm/leads',
      headers: { authorization: `Bearer ${impToken}` },
      payload: {
        company: 'Tentativa de Escrita em Suporte',
        name: 'Teste Impersonate',
        source: 'support'
      }
    });
    assert.equal(postRes.statusCode, 403);
    const postBody = JSON.parse(postRes.payload);
    assert.equal(postBody.error, 'IMPERSONATION_READ_ONLY');
    await app.close();
  });
});
