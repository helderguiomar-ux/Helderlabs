import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { invalidateEntitlementCache } from '../../src/plugins/entitlements';
import { EntitlementService } from '../../src/modules/platform/services/EntitlementService';
import { signAuthToken } from '../../src/plugins/authenticate';
import { prisma } from '../../src/database/prisma/client';

describe('Phase 3 Entitlement Guards (requireApp)', () => {
  test('Tenant sem o módulo Condomínios responde 403 APP_NOT_LICENSED ao aceder a /api/condominios/buildings', async () => {
    const app = buildApp();
    
    // Consultoria Alfa (tem CRM e Finance, mas NÃO tem Condomínios)
    const user = await prisma.user.findFirst({
      where: { email: 'ana@consultoria-alfa.pt' }
    });
    assert.ok(user);

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/condominios/buildings',
      headers: { authorization: `Bearer ${token}` }
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.equal(body.error, 'APP_NOT_LICENSED');
    await app.close();
  });

  test('Módulo suspenso (SUSPENDED) permite GET mas rejeita POST com 403 APP_READ_ONLY', async () => {
    const app = buildApp();

    const tenant = await prisma.tenant.findFirst({ where: { slug: 'consultoria-alfa' } });
    const crmMod = await prisma.module.findFirst({ where: { key: 'crm' } });
    assert.ok(tenant && crmMod);

    // Suspender temporariamente o CRM da Consultoria Alfa para o teste
    await prisma.applicationInstance.update({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: crmMod.id } },
      data: { status: 'SUSPENDED', suspendedAt: new Date() }
    });
    EntitlementService.invalidateCache(tenant.id);
    // A v1.1.0 acrescentou uma cache no plugin requireApp (TTL 60s); sem a
    // invalidar, o teste media a cache e nao a regra de licenciamento.
    invalidateEntitlementCache();

    const user = await prisma.user.findFirst({ where: { email: 'ana@consultoria-alfa.pt' } });
    assert.ok(user);

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    });

    try {
      // GET deve passar (leitura permitida)
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/crm/leads',
        headers: { authorization: `Bearer ${token}` }
      });
      assert.equal(getRes.statusCode, 200);

      // POST (escrita) deve falhar com 403 APP_READ_ONLY
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/crm/leads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          company: 'Empresa Teste Suspensa',
          name: 'Teste',
          source: 'web'
        }
      });
      assert.equal(postRes.statusCode, 403);
      const postBody = JSON.parse(postRes.payload);
      assert.equal(postBody.error, 'APP_READ_ONLY');

    } finally {
      // Restaurar estado ACTIVE no fim do teste
      await prisma.applicationInstance.update({
        where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: crmMod.id } },
        data: { status: 'ACTIVE', suspendedAt: null }
      });
      EntitlementService.invalidateCache(tenant.id);
    // A v1.1.0 acrescentou uma cache no plugin requireApp (TTL 60s); sem a
    // invalidar, o teste media a cache e nao a regra de licenciamento.
    invalidateEntitlementCache();
      await app.close();
    }
  });

  test('Submissão pública de leads via /api/public/leads funciona sem autenticação', async () => {
    const app = buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/leads',
      payload: {
        name: 'Cliente Landing Page',
        company: 'Landing Page Corp',
        email: 'landing@corp.pt',
        message: 'Pedido de demonstração'
      }
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    await app.close();
  });
});
