import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import { signAuthToken } from '../../src/plugins/authenticate';

describe('Account Requests Approval & Rejection Tests', () => {
  const app = buildApp();
  const superAdminToken = signAuthToken({
    sub: 'super-admin-id',
    email: 'admin@helderlabs.eu',
    role: 'SUPER_ADMIN',
    tenantId: 'platform-tenant'
  });

  test('POST /api/platform/account-requests/:id/approve fails if email is not verified', async () => {
    const email = `unverified.test.${Date.now()}@helderlabs.eu`;
    const accountReq = await prisma.accountRequest.create({
      data: {
        email,
        name: 'Carlos Não Verificado',
        companyName: 'Sem Verificação Lda',
        status: 'PENDING_VERIFICATION',
        emailVerifiedAt: null
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${accountReq.id}/approve`,
      headers: { Authorization: `Bearer ${superAdminToken}` },
      payload: {
        role: 'TENANT_ADMIN',
        modules: ['crm']
      }
    });

    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'EMAIL_NOT_VERIFIED');

    await prisma.accountRequest.delete({ where: { id: accountReq.id } });
  });

  test('POST /api/platform/account-requests/:id/approve approves request in single transaction and seeds modules', async () => {
    const email = `approve.test.${Date.now()}@helderlabs.eu`;
    const accountReq = await prisma.accountRequest.create({
      data: {
        email,
        name: 'Ana Fonseca',
        companyName: 'Fonseca Tech Lda',
        intendedModule: 'financas',
        status: 'PENDING',
        emailVerifiedAt: new Date(),
        acceptedTermsAt: new Date(),
        acceptedPrivacyAt: new Date()
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${accountReq.id}/approve`,
      headers: { Authorization: `Bearer ${superAdminToken}` },
      payload: {
        role: 'TENANT_ADMIN',
        modules: ['financas', 'crm']
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.tenantId);

    // Check account request updated to APPROVED
    const updatedReq = await prisma.accountRequest.findUnique({ where: { id: accountReq.id } });
    assert.strictEqual(updatedReq?.status, 'APPROVED');
    assert.strictEqual(updatedReq?.approvedBy, 'super-admin-id');

    // Check user created in active state
    const createdUser = await prisma.user.findUnique({ where: { email } });
    assert.ok(createdUser);
    assert.strictEqual(createdUser?.role, 'TENANT_ADMIN');
    assert.strictEqual(createdUser?.tenantId, body.tenantId);

    // Check application instances created
    const apps = await prisma.applicationInstance.findMany({ where: { tenantId: body.tenantId } });
    assert.strictEqual(apps.length, 2);

    // Check finance categories seeded
    const categories = await prisma.financeCategory.findMany({ where: { tenantId: body.tenantId } });
    assert.ok(categories.length > 0);

    // Cleanup
    await prisma.accountRequest.delete({ where: { id: accountReq.id } });
    await prisma.user.delete({ where: { id: createdUser!.id } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: createdUser!.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: body.tenantId } });
    await prisma.tenantBranding.deleteMany({ where: { tenantId: body.tenantId } });
    await prisma.tenant.delete({ where: { id: body.tenantId } });
  });

  test('POST /api/platform/account-requests/:id/reject updates status to REJECTED with mandatory reason', async () => {
    const email = `reject.test.${Date.now()}@helderlabs.eu`;
    const accountReq = await prisma.accountRequest.create({
      data: {
        email,
        name: 'Rui Costa',
        status: 'PENDING'
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${accountReq.id}/reject`,
      headers: { Authorization: `Bearer ${superAdminToken}` },
      payload: {
        reason: 'Informação da empresa incompleta.'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    const updatedReq = await prisma.accountRequest.findUnique({ where: { id: accountReq.id } });
    assert.strictEqual(updatedReq?.status, 'REJECTED');
    assert.strictEqual(updatedReq?.rejectionReason, 'Informação da empresa incompleta.');

    // Cleanup
    await prisma.accountRequest.delete({ where: { id: accountReq.id } });
  });
});
