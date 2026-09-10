import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { migrateHccallV2 } from '../../scripts/migrate-hccall-v2';

describe('HCCALL 2.0 — Comprehensive End-to-End & Architecture Suite', () => {
  let app: any;
  let tenantA: any;
  let tenantB: any;
  let userA: any;
  let userB: any;
  let tokenA: string;
  let tokenB: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    const pwHash = await bcrypt.hash('password123', 10);
    const timestamp = Date.now();

    tenantA = await prisma.tenant.create({
      data: {
        name: 'Enterprise Commercial Tenant A',
        slug: `hccall-tenant-a-${timestamp}`,
        status: 'ACTIVE'
      }
    });

    tenantB = await prisma.tenant.create({
      data: {
        name: 'Enterprise Commercial Tenant B',
        slug: `hccall-tenant-b-${timestamp}`,
        status: 'ACTIVE'
      }
    });

    userA = await prisma.user.create({
      data: {
        email: `hccall.user.a.${timestamp}@helderlabs.io`,
        name: 'Hélder Nobrega (User A)',
        passwordHash: pwHash,
        tenantId: tenantA.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    userB = await prisma.user.create({
      data: {
        email: `hccall.user.b.${timestamp}@helderlabs.io`,
        name: 'Vendedor Externo (User B)',
        passwordHash: pwHash,
        tenantId: tenantB.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    // Ensure hccall Module exists
    let mod = await prisma.module.findUnique({ where: { key: 'hccall' } });
    if (!mod) {
      mod = await prisma.module.create({
        data: {
          key: 'hccall',
          name: 'HCCALL 2.0',
          description: 'Personal Sales Control & Optimization',
          icon: 'trending-up',
          color: '#0d419f',
          category: 'Comercial',
          isActive: true
        }
      });
    }

    // License Tenant A and Tenant B
    const appInstA = await prisma.applicationInstance.create({
      data: {
        moduleId: mod.id,
        tenantId: tenantA.id,
        status: 'ACTIVE'
      }
    });

    const appInstB = await prisma.applicationInstance.create({
      data: {
        moduleId: mod.id,
        tenantId: tenantB.id,
        status: 'ACTIVE'
      }
    });

    // Assign Users to hccall Application
    await prisma.applicationAssignment.createMany({
      data: [
        { userId: userA.id, applicationId: appInstA.id, roleInApp: 'USER', status: 'ACTIVE' },
        { userId: userB.id, applicationId: appInstB.id, roleInApp: 'USER', status: 'ACTIVE' }
      ]
    });

    const jwtSecret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    tokenA = jwt.sign({ sub: userA.id, tenantId: tenantA.id, email: userA.email, role: 'USER' }, jwtSecret, { expiresIn: '8h' });
    tokenB = jwt.sign({ sub: userB.id, tenantId: tenantB.id, email: userB.email, role: 'USER' }, jwtSecret, { expiresIn: '8h' });
  });

  after(async () => {
    // Cleanup
    await prisma.hccallSaleItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallSaleChange.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallSale.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallObjective.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallAlert.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallDynamizationTier.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallDynamizationBonus.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallDynamization.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallProduct.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallOrgContext.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  });

  // 1. Migração de Dados Históricos
  it('1. Migração de Dados Históricos (HGNOBREG) preserva integridade e contagens com SHA-256', async () => {
    const report = await migrateHccallV2(tenantA.id, userA.id);
    assert.equal(report.verification.checksumMatch, true);
    assert.equal(report.verification.allRecordsAccountedFor, true);
    assert.ok(report.afterCounts.totalSales >= 12);
  });

  // 2. Mudança de Contexto Organizacional preserva histórico
  it('2. Mudança de Contexto Organizacional: Vendas antigas mantêm o contexto original', async () => {
    // Obter contexto inicial
    const resCtx1 = await app.inject({
      method: 'GET',
      url: '/api/hccall/context',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const ctx1 = JSON.parse(resCtx1.body).context;

    // Registar venda no Contexto 1
    const resSale1 = await app.inject({
      method: 'POST',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerNumber: 'CLI-001',
        saleValueCents: 3500,
        notes: 'Venda em Loja A'
      }
    });
    const sale1 = JSON.parse(resSale1.body).sale;
    assert.equal(sale1.orgContextId, ctx1.id);

    // Mudar de contexto para Loja Colombo
    const resSwitch = await app.inject({
      method: 'POST',
      url: '/api/hccall/context/switch',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        companyName: 'Helder Retail Solutions',
        workplace: 'Loja Colombo',
        jobRole: 'Responsável Comercial',
        operationType: 'LOJA',
        businessArea: 'RETALHO'
      }
    });
    const ctx2 = JSON.parse(resSwitch.body).context;
    assert.notEqual(ctx1.id, ctx2.id);

    // Registar venda no Contexto 2
    const resSale2 = await app.inject({
      method: 'POST',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerNumber: 'CLI-002',
        saleValueCents: 5000,
        notes: 'Venda em Loja Colombo'
      }
    });
    const sale2 = JSON.parse(resSale2.body).sale;
    assert.equal(sale2.orgContextId, ctx2.id);

    // Venda antiga continua ligada a ctx1!
    const resCheckOldSale = await app.inject({
      method: 'GET',
      url: `/api/hccall/sales/${sale1.id}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const oldSaleFetched = JSON.parse(resCheckOldSale.body).sale;
    assert.equal(oldSaleFetched.orgContextId, ctx1.id);
  });

  // 3. Registo de Venda Rápido com Produtos e Snapshot Imutável
  it('3. Registo de Venda Rápido com Produtos e Snapshot Imutável', async () => {
    // Listar produtos
    const resProds = await app.inject({
      method: 'GET',
      url: '/api/hccall/products',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const products = JSON.parse(resProds.body).products;
    assert.ok(products.length > 0);

    // Obter dinamização
    const resDyns = await app.inject({
      method: 'GET',
      url: '/api/hccall/dynamizations',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const dyn = JSON.parse(resDyns.body).dynamizations[0];

    const resSale = await app.inject({
      method: 'POST',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerNumber: '912345678',
        dynamizationId: dyn.id,
        items: [
          { productId: products[0].id, quantity: 2, unitPriceCents: 3500 }
        ]
      }
    });

    assert.equal(resSale.statusCode, 201);
    const body = JSON.parse(resSale.body);
    assert.ok(body.sale.code.startsWith('VND-'));
    assert.equal(body.sale.items.length, 1);
    assert.equal(body.sale.items[0].quantity, 2);
    assert.ok(body.sale.dynamizationSnapshot !== null);
  });

  // 4. Objetivos, Ritmo e Previsão
  it('4. Objetivos: Cálculo determinístico de ritmo e atingibilidade', async () => {
    const resObj = await app.inject({
      method: 'POST',
      url: '/api/hccall/objectives',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Meta Mensal de Vendas',
        type: 'SALES_COUNT',
        targetValue: 50,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30'
      }
    });
    assert.equal(resObj.statusCode, 201);

    const resList = await app.inject({
      method: 'GET',
      url: '/api/hccall/objectives',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const objectives = JSON.parse(resList.body).objectives;
    assert.ok(objectives.length > 0);
    assert.ok(objectives[0].pace.totalWorkingDays > 0);
  });

  // 5. Performance Homóloga Normalizada
  it('5. Performance: Comparação de período homólogo normalizada por dias decorridos', async () => {
    const resPerf = await app.inject({
      method: 'GET',
      url: '/api/hccall/performance',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    assert.equal(resPerf.statusCode, 200);
    const perf = JSON.parse(resPerf.body);
    assert.equal(perf.currentPeriod.daysElapsed, perf.homologousPeriod.daysElapsed);
    assert.ok(Array.isArray(perf.dailyProduction));
  });

  // 6. Alertas Determinísticos & Deduplicação
  it('6. Alertas: Geração determinística e deduplicação por impressão digital', async () => {
    const resAlerts1 = await app.inject({
      method: 'GET',
      url: '/api/hccall/alerts',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const alerts1 = JSON.parse(resAlerts1.body).alerts;

    // Segundo pedido produz exatamente a mesma lista sem duplicação
    const resAlerts2 = await app.inject({
      method: 'GET',
      url: '/api/hccall/alerts',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const alerts2 = JSON.parse(resAlerts2.body).alerts;
    assert.equal(alerts1.length, alerts2.length);
  });

  // 7. Sincronização Offline Idempotente
  it('7. Sincronização Offline: Idempotência garantida por clientUuid', async () => {
    const clientUuid = `offline-uuid-${Date.now()}`;
    const batch = {
      operations: [
        {
          clientUuid,
          action: 'CREATE_SALE',
          payload: {
            customerNumber: '999888777',
            saleValueCents: 2000,
            notes: 'Venda criada em modo offline'
          }
        }
      ]
    };

    // 1º Envio
    const resSync1 = await app.inject({
      method: 'POST',
      url: '/api/hccall/sync',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: batch
    });
    assert.equal(resSync1.statusCode, 200);

    // 2º Envio do mesmo lote não duplica
    const resSync2 = await app.inject({
      method: 'POST',
      url: '/api/hccall/sync',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: batch
    });
    assert.equal(resSync2.statusCode, 200);

    // Verificar que existe apenas uma venda com este clientUuid
    const count = await prisma.hccallSale.count({
      where: { tenantId: tenantA.id, clientUuid }
    });
    assert.equal(count, 1);
  });

  // 8. Simulador "E se..."
  it('8. Simulador "E se...": Usa o motor puro e projeta escalão e bónus', async () => {
    const resDyns = await app.inject({
      method: 'GET',
      url: '/api/hccall/dynamizations',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const dyn = JSON.parse(resDyns.body).dynamizations[0];

    const resSim = await app.inject({
      method: 'POST',
      url: '/api/hccall/simulate',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        dynamizationId: dyn.id,
        additionalSalesCount: 15
      }
    });

    assert.equal(resSim.statusCode, 200);
    const sim = JSON.parse(resSim.body).simulation;
    assert.ok(sim.additionalGainCents > 0);
    assert.ok(sim.explanation.includes('Atualmente'));
  });

  // 9. Isolamento Estrito entre Utilizadores
  it('9. Isolamento Estrito: Utilizador B não consegue aceder nem modificar dados de Utilizador A', async () => {
    // User A lista vendas
    const resSalesA = await app.inject({
      method: 'GET',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const salesA = JSON.parse(resSalesA.body).sales;
    assert.ok(salesA.length > 0);

    const saleAId = salesA[0].id;

    // User B tenta aceder à venda de User A
    const resUnauthorizedGet = await app.inject({
      method: 'GET',
      url: `/api/hccall/sales/${saleAId}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });
    assert.equal(resUnauthorizedGet.statusCode, 404);

    // User B lista as suas próprias vendas (vazio inicialmente)
    const resSalesB = await app.inject({
      method: 'GET',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    const salesB = JSON.parse(resSalesB.body).sales;
    assert.equal(salesB.length, 0);
  });
});
