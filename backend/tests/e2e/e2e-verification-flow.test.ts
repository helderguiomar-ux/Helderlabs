import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import authenticatePlugin from '../../src/plugins/authenticate';
import entitlementsPlugin from '../../src/plugins/entitlements';
import { resolveCanonicalModuleKey } from '../../src/config/modules';
import { prisma } from '../../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('E2E Verification & Flow Validation', () => {
  let app: FastifyInstance;
  let testTenantId: string;
  let testUserId: string;
  let validToken: string;

  before(async () => {
    app = Fastify();
    await app.register(authenticatePlugin);
    await app.register(entitlementsPlugin);

    // Setup dummy route simulating /api/me/workspace
    app.get('/api/me/workspace', {
      preHandler: async (req, reply) => {
        await app.authenticate(req, reply);
      }
    }, async (req: any, reply) => {
      return reply.send({ success: true, user: req.user, tenant: { id: req.user.tenantId, name: 'Empresa Teste' } });
    });

    // Setup dummy route protected by requireApp('finance')
    app.get('/api/financas/dashboard', {
      preHandler: async (req, reply) => {
        await app.authenticate(req, reply);
        await app.requireApp('finance')(req, reply);
      }
    }, async (req, reply) => {
      return reply.send({ success: true, kpis: { balanceCents: 150000 } });
    });

    // Setup dummy route for unlicensed app 'unlicensed_module'
    app.get('/api/unlicensed/data', {
      preHandler: async (req, reply) => {
        await app.authenticate(req, reply);
        await app.requireApp('unlicensed_module')(req, reply);
      }
    }, async (req, reply) => {
      return reply.send({ success: true });
    });

    await app.ready();

    // Find or create test tenant and user in db
    let tenant = await prisma.tenant.findFirst({ where: { slug: 'helderlabs-platform' } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: 'HelderLabs Test',
          slug: 'helderlabs-platform',
          status: 'ACTIVE'
        }
      });
    }
    testTenantId = tenant.id;

    let user = await prisma.user.findFirst({ where: { tenantId: testTenantId } });
    if (!user) {
      const pwHash = await bcrypt.hash('password123', 10);
      user = await prisma.user.create({
        data: {
          tenantId: testTenantId,
          email: 'test-admin@helderlabs.eu',
          passwordHash: pwHash,
          name: 'Admin Teste',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE'
        }
      });
    }
    testUserId = user.id;

    const secret = process.env.JWT_SECRET || 'helderlabs-secret-key-development-minimum-32-chars-long';
    validToken = jwt.sign(
      { sub: testUserId, tenantId: testTenantId, role: user.role, email: user.email },
      secret,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    await app.close();
  });

  it('1. should reject unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/workspace'
    });
    assert.equal(res.statusCode, 401);
  });

  it('2. should accept authenticated requests with Bearer JWT on /api/me/workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/workspace',
      headers: {
        authorization: `Bearer ${validToken}`
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.user.sub, testUserId);
  });

  it('3. should allow access to licensed module finance/financas for platform tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/financas/dashboard',
      headers: {
        authorization: `Bearer ${validToken}`
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
  });

  it('4. should block access with 403 APP_NOT_LICENSED for unlicensed module', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/unlicensed/data',
      headers: {
        authorization: `Bearer ${validToken}`
      }
    });
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.match(body.message, /não está licenciado/);
  });

  it('5. should resolve canonical keys properly', () => {
    assert.equal(resolveCanonicalModuleKey('finance'), 'finance');
    assert.equal(resolveCanonicalModuleKey('financas'), 'finance');
    assert.equal(resolveCanonicalModuleKey('crm'), 'crm');
    assert.equal(resolveCanonicalModuleKey('hccall'), 'hccall');
    assert.equal(resolveCanonicalModuleKey('sellmais'), 'sellmais');
  });
});
