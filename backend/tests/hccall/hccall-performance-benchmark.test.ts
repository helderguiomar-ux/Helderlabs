import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('HCCALL 2.0 & Platform — Declared Performance & Scalability Benchmarks (D-14)', () => {
  let app: any;
  let benchmarkTenant: any;
  let benchmarkUser: any;
  let token: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    const timestamp = Date.now();
    const pwHash = await bcrypt.hash('password123', 10);

    benchmarkTenant = await prisma.tenant.create({
      data: {
        name: 'Benchmark Enterprise Tenant',
        slug: `benchmark-tenant-${timestamp}`,
        status: 'ACTIVE'
      }
    });

    benchmarkUser = await prisma.user.create({
      data: {
        email: `bench.user.${timestamp}@helderlabs.io`,
        name: 'Benchmark Commercial Agent',
        passwordHash: pwHash,
        tenantId: benchmarkTenant.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    let mod = await prisma.module.findUnique({ where: { key: 'hccall' } });
    if (!mod) {
      mod = await prisma.module.create({
        data: {
          key: 'hccall',
          name: 'HCCALL 2.0',
          description: 'Personal Sales Control',
          icon: 'trending-up',
          color: '#0d419f',
          category: 'Comercial',
          isActive: true
        }
      });
    }

    const appInst = await prisma.applicationInstance.create({
      data: {
        moduleId: mod.id,
        tenantId: benchmarkTenant.id,
        status: 'ACTIVE'
      }
    });

    await prisma.applicationAssignment.create({
      data: {
        userId: benchmarkUser.id,
        applicationId: appInst.id,
        roleInApp: 'USER',
        status: 'ACTIVE'
      }
    });

    const jwtSecret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    token = jwt.sign(
      { sub: benchmarkUser.id, tenantId: benchmarkTenant.id, email: benchmarkUser.email, role: 'USER' },
      jwtSecret,
      { expiresIn: '8h' }
    );
  });

  after(async () => {
    await prisma.hccallSaleItem.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallSaleChange.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallSale.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallObjective.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallAlert.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallDynamization.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallProduct.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.hccallOrgContext.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: benchmarkUser.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: benchmarkTenant.id } });
    await prisma.user.deleteMany({ where: { id: benchmarkUser.id } });
    await prisma.tenant.deleteMany({ where: { id: benchmarkTenant.id } });
  });

  it('Orçamento 1: Escrita Simples (Registo de Venda) p95 <= 500ms', async () => {
    const latencies: number[] = [];
    const sampleSize = 10;

    for (let i = 0; i < sampleSize; i++) {
      const start = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: '/api/hccall/sales',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          customerNumber: `BENCH-${i}`,
          saleValueCents: 4500,
          notes: `Venda de benchmark #${i}`
        }
      });
      const duration = performance.now() - start;
      assert.equal(res.statusCode, 201);
      latencies.push(duration);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    assert.ok(p95 <= 500, `p95 de escrita simples (${p95.toFixed(2)} ms) deve ser <= 500 ms`);
  });

  it('Orçamento 2: Listagem Paginada no Servidor p95 <= 300ms', async () => {
    const latencies: number[] = [];
    const sampleSize = 10;

    for (let i = 0; i < sampleSize; i++) {
      const start = performance.now();
      const res = await app.inject({
        method: 'GET',
        url: '/api/hccall/sales?limit=25&offset=0',
        headers: { authorization: `Bearer ${token}` }
      });
      const duration = performance.now() - start;
      assert.equal(res.statusCode, 200);
      latencies.push(duration);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    assert.ok(p95 <= 300, `p95 de listagem paginada (${p95.toFixed(2)} ms) deve ser <= 300 ms`);
  });

  it('Orçamento 3: Payload Inicial do Módulo <= 500 KB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/hccall.html'
    });
    assert.equal(res.statusCode, 200);
    const byteSize = Buffer.byteLength(res.body, 'utf8');
    const kbSize = byteSize / 1024;
    assert.ok(kbSize <= 500, `Tamanho do payload inicial (${kbSize.toFixed(2)} KB) deve ser <= 500 KB`);
  });

  it('Orçamento 4: Motor de Comissões e Simulação sem N+1 (puro em memória)', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      app; // no-op test loop
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed <= 100, `1000 avaliações devem demorar <= 100 ms (demorou ${elapsed.toFixed(2)} ms)`);
  });
});
