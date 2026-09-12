import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcrypt';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import { AuthService } from '../../src/modules/auth/services/AuthService';

describe('Public Routes Tests (/api/public)', () => {
  let app: any;

  before(async () => {
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('POST /api/public/register fails if RGPD terms or privacy not accepted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        // Payload completo de propósito: as confirmações e a política de
        // password são agora validadas no schema Zod, pelo que um payload
        // incompleto nunca chegaria à verificação de consentimento RGPD.
        email: 'novo.cliente@exemplo.pt',
        emailConfirmation: 'novo.cliente@exemplo.pt',
        password: 'PasswordSegura2026!',
        passwordConfirmation: 'PasswordSegura2026!',
        acceptedTerms: false,
        acceptedPrivacy: true
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'RGPD_CONSENT_REQUIRED');
  });

  test('POST /api/public/register creates pending_verification account request with OTP when RGPD accepted', async () => {
    const testEmail = `test.reg.${Date.now()}@helderlabs.eu`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email: testEmail,
        emailConfirmation: testEmail,
        password: 'PasswordSegura2026!',
        passwordConfirmation: 'PasswordSegura2026!',
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
    assert.strictEqual(body.status, 'PENDING_VERIFICATION');

    // Verify in DB
    const accountReq = await prisma.accountRequest.findUnique({ where: { email: testEmail } });
    assert.ok(accountReq);
    assert.strictEqual(accountReq?.status, 'PENDING_VERIFICATION');
    assert.strictEqual(accountReq?.emailVerifiedAt, null);
    assert.ok(accountReq?.otpHash);
    assert.ok(accountReq?.acceptedTermsAt);
    assert.ok(accountReq?.acceptedPrivacyAt);

    // Cleanup
    await prisma.accountRequest.delete({ where: { id: accountReq!.id } });
  });

  test('Fluxo completo: Register -> Verify Email -> Resend Code', async () => {
    const testEmail = `test.flow.${Date.now()}@helderlabs.eu`;
    const knownOtp = '987654';
    const knownHash = await bcrypt.hash(knownOtp, 10);

    // 1. Criar pedido de registo
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email: testEmail,
        emailConfirmation: testEmail,
        password: 'PasswordSegura2026!',
        passwordConfirmation: 'PasswordSegura2026!',
        name: 'Vasco Gama',
        companyName: 'Gama Navegações',
        intendedModule: 'crm',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });
    assert.strictEqual(regRes.statusCode, 200);

    // Fixar hash conhecido na BD para testar
    await prisma.accountRequest.update({
      where: { email: testEmail },
      data: { otpHash: knownHash, otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000), otpAttempts: 0 }
    });

    // 2. Tentar validar com código errado
    const wrongRes = await app.inject({
      method: 'POST',
      url: '/api/public/verify-email',
      payload: { email: testEmail, code: '000000' }
    });
    assert.strictEqual(wrongRes.statusCode, 400);
    const wrongBody = JSON.parse(wrongRes.body);
    assert.strictEqual(wrongBody.error, 'INVALID_CODE');

    // 3. Validar com código certo
    const correctRes = await app.inject({
      method: 'POST',
      url: '/api/public/verify-email',
      payload: { email: testEmail, code: knownOtp }
    });
    assert.strictEqual(correctRes.statusCode, 200);
    const correctBody = JSON.parse(correctRes.body);
    assert.strictEqual(correctBody.success, true);
    assert.strictEqual(correctBody.status, 'PENDING');

    const verifiedReq = await prisma.accountRequest.findUnique({ where: { email: testEmail } });
    assert.strictEqual(verifiedReq?.status, 'PENDING');
    assert.ok(verifiedReq?.emailVerifiedAt);

    // Cleanup
    await prisma.accountRequest.delete({ where: { id: verifiedReq!.id } });
  });

  test('AuthService.sendOtp com email desconhecido NÃO cria registos espúrios na BD', async () => {
    const unknownEmail = `unknown.${Date.now()}@desconhecido-helder.pt`;
    const authService = new AuthService();

    const result = await authService.sendOtp(unknownEmail);
    assert.strictEqual(result.success, true);

    // Validar que não foi criado AccountRequest nem User
    const foundReq = await prisma.accountRequest.findUnique({ where: { email: unknownEmail } });
    assert.strictEqual(foundReq, null);

    const foundUser = await prisma.user.findUnique({ where: { email: unknownEmail } });
    assert.strictEqual(foundUser, null);
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
