import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import { signAuthToken } from '../../src/plugins/authenticate';

describe('Tenant Licensing REST API Tests', () => {
  const app = buildApp();
  const superAdminToken = signAuthToken({
    sub: 'super-admin-licensing',
    email: 'admin@helderlabs.eu',
    role: 'SUPER_ADMIN',
    tenantId: 'platform-tenant'
  });

  test('Fluxo Completo de Licenciamento por Tenant', async () => {
    // 1. Criar tenant de teste
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Empresa Teste Licenciamento Lda',
        slug: `lic-test-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    const initialVersion = tenant.entitlementsVersion;

    // 2. GET /api/platform/tenants/:tenantId/licensing (Todos os módulos de SYSTEM_MODULES devem estar presentes)
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/platform/tenants/${tenant.id}/licensing`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });

    assert.strictEqual(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.strictEqual(listBody.success, true);
    assert.strictEqual(listBody.tenantId, tenant.id);
    assert.ok(Array.isArray(listBody.modules));
    assert.strictEqual(listBody.modules.length >= 5, true); // crm, finance, hccall, sellmais, condominios

    const crmModule = listBody.modules.find((m: any) => m.moduleKey === 'crm');
    assert.ok(crmModule);
    assert.strictEqual(crmModule.status, 'UNLICENSED');

    // 3. PUT /api/platform/tenants/:tenantId/licensing/crm (Ativar licença CRM com 1500 cêntimos / 15€ mês)
    const validUntilDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 dias no futuro
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/platform/tenants/${tenant.id}/licensing/crm`,
      headers: { Authorization: `Bearer ${superAdminToken}` },
      payload: {
        status: 'ACTIVE',
        plan: 'pro',
        priceCents: 1500,
        billingPeriod: 'MONTHLY',
        validUntil: validUntilDate,
        graceDays: 5,
        billingNotes: 'Contrato Anual com faturação mensal'
      }
    });

    assert.strictEqual(putRes.statusCode, 200);
    const putBody = JSON.parse(putRes.body);
    assert.strictEqual(putBody.success, true);
    assert.strictEqual(putBody.application.priceCents, 1500);
    assert.strictEqual(putBody.entitlementsVersion, initialVersion + 1);

    // 4. PUT /api/platform/tenants/:tenantId/licensing/finance (Ativar Finance com 3000 cêntimos)
    const putFinRes = await app.inject({
      method: 'PUT',
      url: `/api/platform/tenants/${tenant.id}/licensing/finance`,
      headers: { Authorization: `Bearer ${superAdminToken}` },
      payload: {
        status: 'ACTIVE',
        plan: 'enterprise',
        priceCents: 3000,
        billingPeriod: 'MONTHLY'
      }
    });
    assert.strictEqual(putFinRes.statusCode, 200);

    // 5. GET /api/platform/tenants/:tenantId/licensing para verificar total mensal calculado
    const verifyListRes = await app.inject({
      method: 'GET',
      url: `/api/platform/tenants/${tenant.id}/licensing`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const verifyBody = JSON.parse(verifyListRes.body);
    assert.strictEqual(verifyBody.totalMonthlyCents, 4500); // 1500 + 3000

    // 6. GET /api/platform/licensing/renewals?days=30 (Deve listar o CRM que expira em 20 dias)
    const renewalsRes = await app.inject({
      method: 'GET',
      url: '/api/platform/licensing/renewals?days=30',
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(renewalsRes.statusCode, 200);
    const renewalsBody = JSON.parse(renewalsRes.body);
    assert.strictEqual(renewalsBody.success, true);
    const foundRenewal = renewalsBody.renewals.find((r: any) => r.tenantId === tenant.id && r.moduleKey === 'crm');
    assert.ok(foundRenewal);
    assert.strictEqual(foundRenewal.priceCents, 1500);

    // 7. DELETE /api/platform/tenants/:tenantId/licensing/crm (Desativar licença)
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/platform/tenants/${tenant.id}/licensing/crm`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert.strictEqual(delRes.statusCode, 200);

    const checkDisabled = await app.inject({
      method: 'GET',
      url: `/api/platform/tenants/${tenant.id}/licensing`,
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    const checkDisabledBody = JSON.parse(checkDisabled.body);
    const disabledCrm = checkDisabledBody.modules.find((m: any) => m.moduleKey === 'crm');
    assert.strictEqual(disabledCrm.status, 'DISABLED');
    assert.strictEqual(checkDisabledBody.totalMonthlyCents, 3000); // apenas finance ativo

    // Limpeza
    await prisma.applicationAssignment.deleteMany({ where: { application: { tenantId: tenant.id } } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});
