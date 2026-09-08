import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('HCCALL Telecom Module — E2E & Business Rules', () => {
  let app: any;
  let tenantA: any;
  let tenantB: any;
  let userA1: any;
  let userA2: any;
  let userB: any;
  let tokenA1: string;
  let tokenA2: string;
  let tokenB: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    // 1. Create Tenant A and Tenant B
    const pwHash = await bcrypt.hash('password123', 10);

    tenantA = await prisma.tenant.create({
      data: {
        name: 'Telecom Solutions Tenant A',
        slug: `telecom-a-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    tenantB = await prisma.tenant.create({
      data: {
        name: 'Telecom Solutions Tenant B',
        slug: `telecom-b-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    // 2. Create Users
    userA1 = await prisma.user.create({
      data: {
        email: `operator.a1.${Date.now()}@telecom.pt`,
        name: 'Operador A1',
        passwordHash: pwHash,
        tenantId: tenantA.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    userA2 = await prisma.user.create({
      data: {
        email: `operator.a2.${Date.now()}@telecom.pt`,
        name: 'Operador A2',
        passwordHash: pwHash,
        tenantId: tenantA.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    userB = await prisma.user.create({
      data: {
        email: `operator.b.${Date.now()}@telecom.pt`,
        name: 'Operador B',
        passwordHash: pwHash,
        tenantId: tenantB.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    // 3. Ensure hccall Module & Application Instances exist
    let modHccall = await prisma.module.findUnique({ where: { key: 'hccall' } });
    if (!modHccall) {
      modHccall = await prisma.module.create({
        data: {
          key: 'hccall',
          name: 'HCCALL Telecom',
          description: 'Ferramenta operacional',
          icon: 'headset',
          color: '#0d419f',
          category: 'Comercial',
          isActive: true
        }
      });
    }

    // License Tenant A & Tenant B
    const appInstA = await prisma.applicationInstance.create({
      data: {
        moduleId: modHccall.id,
        tenantId: tenantA.id,
        status: 'ACTIVE'
      }
    });

    await prisma.applicationAssignment.createMany({
      data: [
        { userId: userA1.id, applicationId: appInstA.id, roleInApp: 'USER', status: 'ACTIVE' },
        { userId: userA2.id, applicationId: appInstA.id, roleInApp: 'USER', status: 'ACTIVE' }
      ]
    });

    const appInstB = await prisma.applicationInstance.create({
      data: {
        moduleId: modHccall.id,
        tenantId: tenantB.id,
        status: 'ACTIVE'
      }
    });

    await prisma.applicationAssignment.create({
      data: { userId: userB.id, applicationId: appInstB.id, roleInApp: 'USER', status: 'ACTIVE' }
    });

    // 4. JWT Tokens
    const secret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    tokenA1 = jwt.sign({ sub: userA1.id, email: userA1.email, role: userA1.role, tenantId: userA1.tenantId }, secret, { expiresIn: '1h' });
    tokenA2 = jwt.sign({ sub: userA2.id, email: userA2.email, role: userA2.role, tenantId: userA2.tenantId }, secret, { expiresIn: '1h' });
    tokenB = jwt.sign({ sub: userB.id, email: userB.email, role: userB.role, tenantId: userB.tenantId }, secret, { expiresIn: '1h' });
  });

  after(async () => {
    // Cleanup
    await prisma.hccallSaleChange.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallSale.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallContact.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallCustomer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallPromotion.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallService.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallSaleStatus.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.hccallCounter.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: { in: [userA1.id, userA2.id, userB.id] } } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA1.id, userA2.id, userB.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  });

  it('1. Deve listar serviços padrão e criar dinamização (promoção)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/hccall/services',
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.services));
    assert.ok(body.services.length >= 4);

    const serviceId = body.services[0].id;

    // Create Promotion with 35.00 EUR suggested commission
    const promoRes = await app.inject({
      method: 'POST',
      url: '/api/hccall/promotions',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        name: 'Campanha Fibra Especial Setembro',
        serviceId,
        suggestedCommissionCents: 3500, // 35.00 €
        promoValueCents: 2999, // 29.99 €
        active: true
      }
    });

    assert.equal(promoRes.statusCode, 201);
    const promoBody = JSON.parse(promoRes.payload);
    assert.equal(promoBody.promotion.suggestedCommissionCents, 3500);
    assert.equal(promoBody.promotion.version, 1);
  });

  it('2. REGRA DE OURO: A dinamização sugere, a venda grava e snapshot permanece imutável', async () => {
    // 2.1 Fetch promotion
    const listPromoRes = await app.inject({
      method: 'GET',
      url: '/api/hccall/promotions',
      headers: { authorization: `Bearer ${tokenA1}` }
    });
    const promos = JSON.parse(listPromoRes.payload).promotions;
    const promo = promos.find((p: any) => p.name === 'Campanha Fibra Especial Setembro');
    assert.ok(promo);

    // 2.2 Create sale with this promotion (commission automatically 35.00 €)
    const createSaleRes = await app.inject({
      method: 'POST',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        customerNumber: '912345678',
        customerName: 'Manuel Pereira',
        customerPhone: '+351912345678',
        promotionId: promo.id,
        serviceId: promo.serviceId,
        notes: 'Venda de teste comissionada a 35€'
      }
    });

    assert.equal(createSaleRes.statusCode, 201);
    const saleData = JSON.parse(createSaleRes.payload);
    assert.equal(saleData.sale.commissionCents, 3500);
    assert.equal(saleData.sale.promotionSnapshot.suggestedCommissionCents, 3500);
    assert.equal(saleData.sale.promotionSnapshot.version, 1);
    const saleId = saleData.sale.id;

    // 2.3 Update promotion to 50.00 € (5000 cents)
    const updatePromoRes = await app.inject({
      method: 'PUT',
      url: `/api/hccall/promotions/${promo.id}`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        suggestedCommissionCents: 5000 // Subiu para 50€!
      }
    });
    assert.equal(updatePromoRes.statusCode, 200);
    const updatedPromo = JSON.parse(updatePromoRes.payload).promotion;
    assert.equal(updatedPromo.suggestedCommissionCents, 5000);
    assert.equal(updatedPromo.version, 2); // Versão incrementada

    // 2.4 Re-fetch previous sale: MUST STILL BE 35.00 € WITH SNAPSHOT v1
    const getSaleRes = await app.inject({
      method: 'GET',
      url: `/api/hccall/sales/${saleId}`,
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(getSaleRes.statusCode, 200);
    const reloadedSale = JSON.parse(getSaleRes.payload).sale;
    assert.equal(reloadedSale.commissionCents, 3500, 'A comissão da venda passada não pode mudar!');
    assert.equal(reloadedSale.promotionSnapshot.suggestedCommissionCents, 3500);
    assert.equal(reloadedSale.promotionSnapshot.version, 1);
  });

  it('3. Histórico de alterações: Mutação explícita de venda gera HccallSaleChange', async () => {
    // Fetch sale
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA1}` }
    });
    const sale = JSON.parse(listRes.payload).items[0];
    assert.ok(sale);

    // Update commission to 40.00 €
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/hccall/sales/${sale.id}`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        commissionCents: 4000,
        reason: 'Ajuste de bónus acordado com operador'
      }
    });

    assert.equal(updateRes.statusCode, 200);

    // Check sale change history
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/hccall/sales/${sale.id}`,
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    const detailData = JSON.parse(detailRes.payload).sale;
    assert.equal(detailData.commissionCents, 4000);
    assert.ok(Array.isArray(detailData.changes));
    const commChange = detailData.changes.find((c: any) => c.field === 'commissionCents');
    assert.ok(commChange);
    assert.equal(commChange.oldValue, '35.00 €');
    assert.equal(commChange.newValue, '40.00 €');
    assert.equal(commChange.reason, 'Ajuste de bónus acordado com operador');
  });

  it('4. Isolamento Multi-Tenant estrito entre Tenant A e Tenant B', async () => {
    // Tenant B cannot access Tenant A's sales
    const listResA = await app.inject({
      method: 'GET',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenA1}` }
    });
    const saleA = JSON.parse(listResA.payload).items[0];
    assert.ok(saleA);

    const crossGetRes = await app.inject({
      method: 'GET',
      url: `/api/hccall/sales/${saleA.id}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });

    assert.notEqual(crossGetRes.statusCode, 200);

    // Tenant B listing is completely isolated
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/hccall/sales',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    const salesB = JSON.parse(listResB.payload).items;
    assert.equal(salesB.length, 0);
  });

  it('5. Sincronização Offline Idempotente via POST /api/hccall/sync', async () => {
    const clientUuid = `offline-uuid-${Date.now()}`;
    const batchPayload = {
      operations: [
        {
          clientUuid,
          action: 'CREATE_SALE',
          payload: {
            customerNumber: '933444555',
            customerName: 'Ana Martins',
            commissionCents: 4500,
            saleValueCents: 5990,
            notes: 'Registo offline no telemóvel'
          },
          occurredAt: new Date().toISOString()
        }
      ]
    };

    // First sync attempt -> Applied
    const sync1Res = await app.inject({
      method: 'POST',
      url: '/api/hccall/sync',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: batchPayload
    });

    assert.equal(sync1Res.statusCode, 200);
    const sync1Data = JSON.parse(sync1Res.payload);
    assert.equal(sync1Data.summary.applied, 1);
    assert.equal(sync1Data.summary.duplicate, 0);

    // Second sync attempt with SAME clientUuid -> Duplicate (Idempotent, no extra sale)
    const sync2Res = await app.inject({
      method: 'POST',
      url: '/api/hccall/sync',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: batchPayload
    });

    assert.equal(sync2Res.statusCode, 200);
    const sync2Data = JSON.parse(sync2Res.payload);
    assert.equal(sync2Data.summary.applied, 0);
    assert.equal(sync2Data.summary.duplicate, 1);
  });

  it('6. Dashboard e métricas agregadas por commissionState', async () => {
    const dashRes = await app.inject({
      method: 'GET',
      url: '/api/hccall/dashboard',
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(dashRes.statusCode, 200);
    const dashData = JSON.parse(dashRes.payload);
    assert.ok(dashData.today);
    assert.ok(dashData.thisMonth);
    assert.ok(dashData.today.count >= 2);
    assert.ok(typeof dashData.today.totalCommissionCents === 'number');
  });

  it('7. Exportação CSV com BOM UTF-8 e separador ";"', async () => {
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/hccall/export',
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(exportRes.statusCode, 200);
    assert.ok(exportRes.headers['content-type']?.includes('text/csv'));
    assert.ok(exportRes.payload.startsWith('\uFEFFCódigo;Cliente;Serviço'));
  });
});
