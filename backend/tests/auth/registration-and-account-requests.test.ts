import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';

describe('Bloco 1 — Autenticação, Registo com Confirmações & Pedidos de Acesso', () => {
  let app: any;
  let superAdminUser: any;
  let superAdminToken: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    // Setup Super Admin para aprovações
    const superAdminTenant = await prisma.tenant.upsert({
      where: { slug: 'platform-admin-test' },
      update: {},
      create: {
        id: `tenant_admin_${Date.now()}`,
        name: 'Plataforma Admin Teste',
        slug: 'platform-admin-test',
        status: 'ACTIVE'
      }
    });

    superAdminUser = await prisma.user.create({
      data: {
        tenantId: superAdminTenant.id,
        name: 'Super Admin Test',
        email: `superadmin.${Date.now()}@helderlabs.eu`,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE'
      }
    });

    const secret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    superAdminToken = jwt.sign(
      { sub: superAdminUser.id, email: superAdminUser.email, role: superAdminUser.role, tenantId: superAdminTenant.id },
      secret,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    if (superAdminUser) {
      await prisma.user.deleteMany({ where: { id: superAdminUser.id } });
    }
    await app.close();
  });

  it('1. Validação de Registo: Rejeita se email e emailConfirmation não coincidirem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        name: 'Carlos Silva',
        email: 'carlos@empresa.pt',
        emailConfirmation: 'carlos.diferente@empresa.pt',
        companyName: 'Silva Lda',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.equal(body.error, 'EMAILS_DO_NOT_MATCH');
  });

  it('2. Validação de Registo: Rejeita se password e passwordConfirmation não coincidirem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        name: 'Carlos Silva',
        email: 'carlos.valido@empresa.pt',
        emailConfirmation: 'carlos.valido@empresa.pt',
        password: 'PasswordSegura123!',
        passwordConfirmation: 'OutraPassword123!',
        companyName: 'Silva Lda',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.equal(body.error, 'PASSWORDS_DO_NOT_MATCH');
  });

  it('3. Fluxo E2E: Registo -> Verificação OTP -> Listagem no Super Admin -> Aprovação com Módulos e Login com Password Definida', async () => {
    const email = `novo.cliente.${Date.now()}@helderlabs.eu`;
    const password = 'MinhaPasswordForte2026!';

    // 1. Submeter Registo com Email + Confirm Email + Password + Confirm Password
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        name: 'Duarte Pacheco',
        email,
        emailConfirmation: email,
        password,
        passwordConfirmation: password,
        companyName: 'Pacheco Engenharia Lda',
        phone: '912345678',
        intendedModule: 'hccall',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.equal(regRes.statusCode, 200);
    const regBody = JSON.parse(regRes.payload);
    assert.equal(regBody.success, true);
    assert.equal(regBody.status, 'PENDING_VERIFICATION');

    // 2. Simular OTP fixado para verificação de email
    const knownOtp = '654321';
    const otpHash = await bcrypt.hash(knownOtp, 10);
    await prisma.accountRequest.update({
      where: { email },
      data: { otpHash, otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000) }
    });

    // 3. Validar email com OTP
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/public/verify-email',
      payload: { email, code: knownOtp }
    });

    assert.equal(verifyRes.statusCode, 200);
    const verifyBody = JSON.parse(verifyRes.payload);
    assert.equal(verifyBody.status, 'PENDING');

    // 4. Verificar que o pedido chega à lista do Super Admin
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/platform/account-requests',
      headers: { authorization: `Bearer ${superAdminToken}` }
    });

    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    const targetReq = listBody.requests.find((r: any) => r.email === email);
    assert.ok(targetReq, 'Pedido de conta DEVE aparecer na lista de pedidos do Super Admin');
    assert.equal(targetReq.status, 'PENDING');
    assert.ok(targetReq.emailVerifiedAt, 'Email deve estar registado como validado');

    // 5. Super Admin aprova o pedido e atribui módulos
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${targetReq.id}/approve`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: {
        role: 'TENANT_ADMIN',
        modules: ['crm', 'hccall']
      }
    });

    assert.equal(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.payload);
    assert.equal(approveBody.success, true);
    assert.ok(approveBody.tenantId);
    assert.ok(approveBody.user);

    // 6. Utilizador aprovado faz login imediato com a password fornecida no registo
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email,
        password
      }
    });

    assert.equal(loginRes.statusCode, 200, 'Login com a password registada deve ser bem sucedido');
    const loginBody = JSON.parse(loginRes.payload);
    assert.ok(loginBody.token, 'Deve retornar token JWT');
    assert.equal(loginBody.user.email, email);

    // 7. Utilizador obtém o manifesto com os módulos licenciados
    const wsRes = await app.inject({
      method: 'GET',
      url: '/api/me/workspace',
      headers: { authorization: `Bearer ${loginBody.token}` }
    });

    assert.equal(wsRes.statusCode, 200);
    const wsBody = JSON.parse(wsRes.payload);
    assert.ok(Array.isArray(wsBody.apps), 'Manifesto deve conter lista de apps');
    assert.ok(wsBody.apps.some((a: any) => a.key === 'crm' && a.state === 'ACTIVE'), 'CRM deve estar ativo no manifesto');
    assert.ok(wsBody.apps.some((a: any) => a.key === 'hccall' && a.state === 'ACTIVE'), 'HCCALL deve estar ativo no manifesto');

    // Limpeza
    const createdTenantId = approveBody.tenantId;
    await prisma.applicationAssignment.deleteMany({ where: { userId: approveBody.user.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: createdTenantId } });
    await prisma.user.deleteMany({ where: { id: approveBody.user.id } });
    await prisma.tenantBranding.deleteMany({ where: { tenantId: createdTenantId } });
    await prisma.accountRequest.deleteMany({ where: { email } });
    await prisma.tenant.deleteMany({ where: { id: createdTenantId } });
  });

  it('4. Rejeição de Pedido de Conta: Exige motivo e atualiza status para REJECTED', async () => {
    const email = `rejeitar.${Date.now()}@helderlabs.eu`;

    // Criar pedido validado
    const req = await prisma.accountRequest.create({
      data: {
        email,
        name: 'Candidato Rejeitado',
        status: 'PENDING',
        emailVerifiedAt: new Date()
      }
    });

    // 1. Tentar rejeitar sem motivo -> Falha com 400
    const failRes = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${req.id}/reject`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { reason: '' }
    });
    assert.equal(failRes.statusCode, 400);

    // 2. Rejeitar com motivo válido
    const okRes = await app.inject({
      method: 'POST',
      url: `/api/platform/account-requests/${req.id}/reject`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { reason: 'Empresa fora da área geográfica de cobertura suportada' }
    });

    assert.equal(okRes.statusCode, 200);
    const updated = await prisma.accountRequest.findUnique({ where: { id: req.id } });
    assert.equal(updated?.status, 'REJECTED');
    assert.equal(updated?.rejectionReason, 'Empresa fora da área geográfica de cobertura suportada');
    assert.equal(updated?.rejectedBy, superAdminUser.id);

    // Limpeza
    await prisma.accountRequest.delete({ where: { id: req.id } });
  });
});
