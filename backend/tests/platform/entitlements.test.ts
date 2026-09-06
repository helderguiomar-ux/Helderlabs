import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { EntitlementService } from '../../src/modules/platform/services/EntitlementService';
import { signAuthToken } from '../../src/plugins/authenticate';
import { prisma } from '../../src/database/prisma/client';

describe('Phase 2 EntitlementService & Workspace Manifest', () => {
  test('resolveForUser devolve o manifesto completo com assinatura HMAC', async () => {
    const service = new EntitlementService();
    const user = await prisma.user.findFirst({
      where: { email: 'ana@consultoria-alfa.pt' }
    });
    assert.ok(user, 'Utilizador de teste deve existir na BD');

    const manifest = await service.resolveForUser(user.id, user.tenantId);
    assert.ok(manifest);
    assert.equal(manifest.user.email, 'ana@consultoria-alfa.pt');
    assert.ok(manifest.apps.length >= 2);
    assert.ok(manifest.signature);
    assert.ok(manifest.branding);
  });

  test('GET /api/me/workspace responde 200 com o manifesto do utilizador', async () => {
    const app = buildApp();
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
      url: '/api/me/workspace',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.user.email, 'ana@consultoria-alfa.pt');
    assert.ok(Array.isArray(body.apps));
    await app.close();
  });
});
