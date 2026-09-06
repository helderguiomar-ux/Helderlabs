import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';

describe('Public Routes Tests (/api/public)', () => {
  const app = buildApp();

  test('POST /api/public/register fails if RGPD terms or privacy not accepted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email: 'novo.cliente@exemplo.pt',
        acceptedTerms: false,
        acceptedPrivacy: true
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'RGPD_CONSENT_REQUIRED');
  });

  test('POST /api/public/register creates pending account request with OTP when RGPD accepted', async () => {
    const testEmail = `test.reg.${Date.now()}@helderlabs.eu`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email: testEmail,
        name: 'Maria Santos',
        companyName: 'Santos & Associados',
        intendedModule: 'crm',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    // Verify in DB
    const accountReq = await prisma.accountRequest.findUnique({ where: { email: testEmail } });
    assert.ok(accountReq);
    assert.strictEqual(accountReq?.status, 'PENDING');
    assert.ok(accountReq?.otpHash);
    assert.ok(accountReq?.acceptedTermsAt);
    assert.ok(accountReq?.acceptedPrivacyAt);

    // Cleanup
    await prisma.accountRequest.delete({ where: { id: accountReq!.id } });
  });

  test('POST /api/public/leads returns 503 if platform tenant slug is missing', async () => {
    const oldSlug = process.env.PLATFORM_TENANT_SLUG;
    process.env.PLATFORM_TENANT_SLUG = 'in-existent-platform-tenant-slug';

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/leads',
      payload: {
        name: 'Carlos Oliveira',
        email: 'carlos@empresa.pt',
        message: 'Gostaria de agendar um diagnóstico de processos.',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.strictEqual(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'PLATFORM_UNAVAILABLE');

    process.env.PLATFORM_TENANT_SLUG = oldSlug;
  });
});
