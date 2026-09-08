import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('2SELLMAIS Module — E2E & Business Rules', () => {
  let app: any;
  let tenantA: any;
  let tenantB: any;
  let userA1: any; // ADMIN / MANAGER
  let userA2: any; // OPERATOR
  let userB: any;
  let tokenA1: string;
  let tokenA2: string;
  let tokenB: string;

  let itemTypeId: string;
  let channelId: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    const pwHash = await bcrypt.hash('password123', 10);

    // 1. Tenants
    tenantA = await prisma.tenant.create({
      data: {
        name: 'Antiguidades & Colecionismo Tenant A',
        slug: `antiques-a-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    tenantB = await prisma.tenant.create({
      data: {
        name: 'Antiques B',
        slug: `antiques-b-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    // 2. Users
    userA1 = await prisma.user.create({
      data: {
        email: `manager.a1.${Date.now()}@2sellmais.pt`,
        name: 'Gestor A1',
        passwordHash: pwHash,
        tenantId: tenantA.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE'
      }
    });

    userA2 = await prisma.user.create({
      data: {
        email: `operator.a2.${Date.now()}@2sellmais.pt`,
        name: 'Operador A2',
        passwordHash: pwHash,
        tenantId: tenantA.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    userB = await prisma.user.create({
      data: {
        email: `user.b.${Date.now()}@2sellmais.pt`,
        name: 'Utilizador B',
        passwordHash: pwHash,
        tenantId: tenantB.id,
        role: 'USER',
        status: 'ACTIVE'
      }
    });

    // 3. Module & App Instances
    let modSellmais = await prisma.module.findUnique({ where: { key: 'sellmais' } });
    if (!modSellmais) {
      modSellmais = await prisma.module.create({
        data: {
          key: 'sellmais',
          name: '2SELLMAIS',
          description: 'Gestão de inventário e antiguidades',
          icon: 'shopping-bag',
          color: '#b45309',
          category: 'Comercial',
          isActive: true
        }
      });
    }

    const appInstA = await prisma.applicationInstance.create({
      data: {
        moduleId: modSellmais.id,
        tenantId: tenantA.id,
        status: 'ACTIVE'
      }
    });

    await prisma.applicationAssignment.createMany({
      data: [
        { userId: userA1.id, applicationId: appInstA.id, roleInApp: 'ADMIN', status: 'ACTIVE' },
        { userId: userA2.id, applicationId: appInstA.id, roleInApp: 'OPERATOR', status: 'ACTIVE' }
      ]
    });

    const appInstB = await prisma.applicationInstance.create({
      data: {
        moduleId: modSellmais.id,
        tenantId: tenantB.id,
        status: 'ACTIVE'
      }
    });

    await prisma.applicationAssignment.create({
      data: { userId: userB.id, applicationId: appInstB.id, roleInApp: 'ADMIN', status: 'ACTIVE' }
    });

    // 4. JWT Tokens
    const secret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    tokenA1 = jwt.sign({ sub: userA1.id, email: userA1.email, role: userA1.role, tenantId: userA1.tenantId }, secret, { expiresIn: '1h' });
    tokenA2 = jwt.sign({ sub: userA2.id, email: userA2.email, role: userA2.role, tenantId: userA2.tenantId }, secret, { expiresIn: '1h' });
    tokenB = jwt.sign({ sub: userB.id, email: userB.email, role: userB.role, tenantId: userB.tenantId }, secret, { expiresIn: '1h' });
  });

  after(async () => {
    // Cleanup in reverse dependency order
    await prisma.sellBid.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellAuctionLot.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellAuction.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellChannelJob.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellChannelListing.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellChannel.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellConsignmentItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellConsignment.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellItemEvent.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellRestoration.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellProvenance.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellItemMedia.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellItemCost.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellLocation.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellItemType.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.sellCounter.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: { in: [userA1.id, userA2.id, userB.id] } } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userA1.id, userA2.id, userB.id] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  });

  it('1. Deve inicializar tipos de artigo padrão e criar canais', async () => {
    // 1.1 List item types (creates defaults on first call)
    const typesRes = await app.inject({
      method: 'GET',
      url: '/api/sellmais/types',
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(typesRes.statusCode, 200);
    const typesBody = JSON.parse(typesRes.payload);
    assert.equal(typesBody.success, true);
    assert.ok(Array.isArray(typesBody.types));
    assert.ok(typesBody.types.length >= 4);

    const watchType = typesBody.types.find((t: any) => t.key === 'relogio' || t.name.toLowerCase().includes('reloj'));
    assert.ok(watchType, 'Tipo de relojoaria deve existir nos defaults');
    itemTypeId = watchType.id;

    // 1.2 Create Channel (OLX)
    const channelRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/channels',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        code: 'OLX',
        name: 'OLX Portugal',
        type: 'EXTERNAL_MARKETPLACE',
        commissionRate: 5.0,
        syncMode: 'ASYNC_OUTBOX',
        isActive: true
      }
    });

    assert.equal(channelRes.statusCode, 201);
    const channelBody = JSON.parse(channelRes.payload);
    assert.equal(channelBody.success, true);
    assert.equal(channelBody.channel.code, 'olx');
    channelId = channelBody.channel.id;
  });

  let createdItemId: string;
  let createdItemSlug: string;

  it('2. Deve criar artigo com atributos JSONB e número sequencial ART-YYYY-NNNN', async () => {
    const payload = {
      title: 'Relógio de Bolso Vintage em Prata Séc. XIX',
      typeId: itemTypeId,
      acquisitionType: 'DIRECT_PURCHASE',
      acquisitionCents: 15000, // 150.00 EUR
      priceCents: 35000,       // 350.00 EUR
      minPriceCents: 28000,    // 280.00 EUR
      description: 'Exemplar raro de colecionador em prata de lei 925 com mecanismo mecânico funcional.',
      condition: 'VERY_GOOD',
      era: 'Século XIX',
      origin: 'Suíça',
      attributes: {
        marca: 'Omega',
        movimento: 'Manual',
        materialCaixa: 'Prata 925',
        caixaOriginal: true
      }
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/sellmais/items',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.ok(body.item.id);
    assert.ok(body.item.code.startsWith('ART-'));
    assert.equal(body.item.status, 'DRAFT');
    assert.equal(body.item.acquisitionCents, 15000);
    assert.equal(body.item.totalCostCents, 15000); // Acquisition only initially
    assert.equal(body.item.attributes.movimento, 'Manual');

    createdItemId = body.item.id;
    createdItemSlug = body.item.slug;
  });

  it('3. Regra de Ouro: Materialização de custos em tempo real (restauro + limpeza)', async () => {
    // Add Restoration Cost: 50.00 EUR
    const cost1 = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/costs`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        category: 'RESTORATION',
        description: 'Substituição do vidro mineral e lubrificação do escape',
        amountCents: 5000,
        supplierName: 'Mestre Relojoeiro Silva'
      }
    });
    assert.equal(cost1.statusCode, 201);

    // Add Certification Cost: 20.00 EUR
    const cost2 = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/costs`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        category: 'CERTIFICATION',
        description: 'Certificado de autenticidade da prata',
        amountCents: 2000
      }
    });
    assert.equal(cost2.statusCode, 201);

    // Verify item cost materialization
    const itemRes = await app.inject({
      method: 'GET',
      url: `/api/sellmais/items/${createdItemId}`,
      headers: { authorization: `Bearer ${tokenA1}` }
    });

    assert.equal(itemRes.statusCode, 200);
    const item = JSON.parse(itemRes.payload).item;
    assert.equal(item.acquisitionCents, 15000); // 150€
    assert.equal(item.extraCostsCents, 7000);    // 50€ + 20€ = 70€
    assert.equal(item.totalCostCents, 22000);    // 150€ + 70€ = 220€
    assert.equal(item.costs.length, 2);
  });

  it('4. Máquina de Estados: Transições válidas e bloqueio de transições inválidas (409 Conflict)', async () => {
    // 4.1 Invalid transition: DRAFT -> SOLD (Should fail with 409 Conflict)
    const invalidRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'SOLD'
      }
    });
    assert.equal(invalidRes.statusCode, 409, 'DRAFT -> SOLD direto deve ser rejeitado com 409');

    // 4.2 Valid transition: DRAFT -> AVAILABLE
    const availRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'AVAILABLE',
        notes: 'Artigo concluído e disponível para venda'
      }
    });
    assert.equal(availRes.statusCode, 200);
    const availItem = JSON.parse(availRes.payload).item;
    assert.equal(availItem.status, 'AVAILABLE');

    // 4.3 Valid transition: AVAILABLE -> RESERVED
    const resRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'RESERVED',
        notes: 'Reserva para cliente colecionador'
      }
    });
    assert.equal(resRes.statusCode, 200);
    assert.equal(JSON.parse(resRes.payload).item.status, 'RESERVED');

    // 4.4 Valid transition: RESERVED -> SOLD
    const soldRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'SOLD',
        salePriceCents: 35000,
        buyerName: 'Dr. Afonso Henriques',
        notes: 'Venda a pronto pagamento'
      }
    });
    assert.equal(soldRes.statusCode, 200);
    const soldItem = JSON.parse(soldRes.payload).item;
    assert.equal(soldItem.status, 'SOLD');
    assert.equal(soldItem.soldPriceCents, 35000);
    // Real Profit: 35000 - 22000 (totalCost) = 13000 Cents (130.00 EUR)
    assert.equal(soldItem.realProfitCents, 13000);

    // 4.5 Invalid transition: SOLD -> AVAILABLE (Direct reversal not allowed without return)
    const invalidBackRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'AVAILABLE'
      }
    });
    assert.equal(invalidBackRes.statusCode, 409, 'SOLD -> AVAILABLE direto deve ser rejeitado com 409');

    // 4.6 Valid transition: SOLD -> RETURNED (Customer return/devolução)
    const returnRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'RETURNED',
        notes: 'Devolução autorizada pelo gerente'
      }
    });
    assert.equal(returnRes.statusCode, 200);
    assert.equal(JSON.parse(returnRes.payload).item.status, 'RETURNED');
  });

  it('5. Gestão de Consignações: Contrato, comissão e liquidação a comitente', async () => {
    // 5.1 Create Consignment Agreement
    const consRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/consignments',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        consignorName: 'D. Maria Teresa de Bragança',
        consignorEmail: 'maria.teresa@exemplo.pt',
        consignorPhone: '+351 919 888 777',
        defaultCommissionRate: 20.0, // 20% shop commission
        notes: 'Espólio de família'
      }
    });

    assert.equal(consRes.statusCode, 201);
    const consBody = JSON.parse(consRes.payload);
    assert.equal(consBody.success, true);
    assert.ok(consBody.consignment.code.startsWith('CSG-'));
    const consignmentId = consBody.consignment.id;

    // 5.2 Create Consigned Item
    const itemRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/items',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        title: 'Jarra em Porcelana Companhia das Índias',
        typeId: itemTypeId,
        acquisitionType: 'CONSIGNMENT',
        consignmentId: consignmentId,
        acquisitionCents: 0, // Consigned items have 0 acquisition cost upfront
        priceCents: 80000,   // 800.00 EUR
        minPriceCents: 70000,
        description: 'Jarra dinastia Qing em perfeito estado de conservação.',
        condition: 'MINT'
      }
    });

    assert.equal(itemRes.statusCode, 201);
    const consignedItemId = JSON.parse(itemRes.payload).item.id;

    // 5.3 Make available and sell
    await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${consignedItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: { toStatus: 'AVAILABLE' }
    });

    const soldRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${consignedItemId}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        toStatus: 'SOLD',
        salePriceCents: 80000,
        buyerName: 'Colecionador Privado'
      }
    });
    assert.equal(soldRes.statusCode, 200);

    // 5.4 Settle Consignment Item
    // Sale: 800.00€, Commission (20%): 160.00€ (16000 cents), Consignor Payout: 640.00€ (64000 cents)
    const settleRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/consignments/${consignmentId}/items/${consignedItemId}/settle`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        agreedPayoutCents: 64000,
        shopCommissionCents: 16000
      }
    });

    assert.equal(settleRes.statusCode, 200);
    const settled = JSON.parse(settleRes.payload);
    assert.equal(settled.success, true);
    assert.equal(settled.consignmentItem.status, 'SETTLED');
    assert.equal(settled.consignmentItem.consignorPayoutCents, 64000);
    assert.equal(settled.consignmentItem.shopCommissionCents, 16000);
  });

  it('6. Leilões e Concorrência: Loteamento, incrementos e lances atómicos', async () => {
    // 6.1 Create Auction
    const auctionRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/auctions',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        title: 'Grande Leilão de Primavera 2026',
        description: 'Velharias e Peças Raras',
        startsAt: new Date(Date.now() - 3600000).toISOString(), // started 1h ago
        endsAt: new Date(Date.now() + 86400000).toISOString(),   // ends in 24h
        buyerPremiumRate: 15.0
      }
    });

    assert.equal(auctionRes.statusCode, 201);
    const auction = JSON.parse(auctionRes.payload).auction;
    const auctionId = auction.id;

    // 6.2 Create Item for Auction
    const itemRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/items',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        title: 'Moeda de Ouro D. João V 1730',
        typeId: itemTypeId,
        acquisitionType: 'DIRECT_PURCHASE',
        acquisitionCents: 40000,
        priceCents: 60000,
        description: 'Moeda rara em ouro'
      }
    });
    const auctionItemId = JSON.parse(itemRes.payload).item.id;

    // 6.3 Add Lot to Auction
    const lotRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/auctions/${auctionId}/lots`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        itemId: auctionItemId,
        lotNumber: 1,
        startingPriceCents: 50000, // 500.00 EUR
        reservePriceCents: 70000,  // 700.00 EUR
        minBidIncrementCents: 2500 // 25.00 EUR increment
      }
    });

    assert.equal(lotRes.statusCode, 201);
    const lotId = JSON.parse(lotRes.payload).lot.id;

    // 6.4 Place First Bid: 500.00 EUR (50000 cents)
    const bid1 = await app.inject({
      method: 'POST',
      url: `/api/sellmais/auctions/${auctionId}/lots/${lotId}/bid`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        bidderName: 'Licor & Ouro Lda',
        bidderEmail: 'licor@ouro.pt',
        amountCents: 50000
      }
    });
    assert.equal(bid1.statusCode, 201);
    const bid1Body = JSON.parse(bid1.payload);
    assert.equal(bid1Body.success, true);
    assert.equal(bid1Body.lot.currentBidCents, 50000);
    assert.equal(bid1Body.lot.bidCount, 1);

    // 6.5 Place Invalid Underbid: 510.00 EUR (must be >= 500.00 + 25.00 = 525.00 EUR)
    const invalidBid = await app.inject({
      method: 'POST',
      url: `/api/sellmais/auctions/${auctionId}/lots/${lotId}/bid`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        bidderName: 'Numismática Lisboa',
        bidderEmail: 'info@numismatica.pt',
        amountCents: 51000
      }
    });
    assert.equal(invalidBid.statusCode, 400, 'Lance abaixo do incremento mínimo deve ser rejeitado');

    // 6.6 Place Valid Higher Bid: 550.00 EUR (55000 cents)
    const bid2 = await app.inject({
      method: 'POST',
      url: `/api/sellmais/auctions/${auctionId}/lots/${lotId}/bid`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        bidderName: 'Numismática Lisboa',
        bidderEmail: 'info@numismatica.pt',
        amountCents: 55000
      }
    });
    assert.equal(bid2.statusCode, 201);
    assert.equal(JSON.parse(bid2.payload).lot.currentBidCents, 55000);
    assert.equal(JSON.parse(bid2.payload).lot.bidCount, 2);
  });

  it('7. Catálogo Público SSR e Proteção de Dados: Whitelist e SEO sem fuga de custos confidenciais', async () => {
    // 7.1 Create item available for public catalog
    const publicItemRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/items',
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: {
        title: 'Mesa de Pé de Galo Século XVIII em Mogno Maciço',
        typeId: itemTypeId,
        acquisitionType: 'DIRECT_PURCHASE',
        acquisitionCents: 30000,  // CONFIDENCIAL: 300.00 EUR
        priceCents: 95000,        // PÚBLICO: 950.00 EUR
        minPriceCents: 75000,     // CONFIDENCIAL: 750.00 EUR
        description: 'Mesa de pé de galo autêntica séc. XVIII em mogno maciço com tampo circular rebatível.',
        condition: 'EXCELLENT',
        era: 'Século XVIII',
        origin: 'Inglaterra',
        supplierName: 'Fornecedor Confidencial Silva' // CONFIDENCIAL
      }
    });
    const pubItem = JSON.parse(publicItemRes.payload).item;

    // Transition to AVAILABLE
    await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${pubItem.id}/transition`,
      headers: { authorization: `Bearer ${tokenA1}` },
      payload: { toStatus: 'AVAILABLE' }
    });

    // 7.2 SSR Catalog Listing: GET /loja
    const catalogRes = await app.inject({
      method: 'GET',
      url: '/loja'
    });

    assert.equal(catalogRes.statusCode, 200);
    assert.ok(catalogRes.headers['content-type']?.includes('text/html'));
    const htmlCatalog = catalogRes.payload;

    // Must contain store title and article
    assert.ok(htmlCatalog.includes('2SELLMAIS'));
    assert.ok(htmlCatalog.includes('Mesa de Pé de Galo Século XVIII'));
    assert.ok(htmlCatalog.includes('950.00')); // Public price formatted

    // MUST NOT leak confidential business metrics into public SSR HTML
    assert.ok(!htmlCatalog.includes('Fornecedor Confidencial Silva'), 'Fornecedor não pode ser visível no HTML público');
    assert.ok(!htmlCatalog.includes('acquisitionCents'), 'acquisitionCents não pode ser exposto');
    assert.ok(!htmlCatalog.includes('minPriceCents'), 'minPriceCents não pode ser exposto');

    // 7.3 SSR Item Detail: GET /loja/artigo/:slug
    const detailRes = await app.inject({
      method: 'GET',
      url: `/loja/artigo/${pubItem.slug}`
    });

    assert.equal(detailRes.statusCode, 200);
    const htmlDetail = detailRes.payload;

    // Verify SEO OpenGraph & JSON-LD
    assert.ok(htmlDetail.includes('application/ld+json'), 'Deve incluir dados estruturados JSON-LD Schema.org');
    assert.ok(htmlDetail.includes('"@type":"Product"') || htmlDetail.includes('"@type": "Product"'), 'JSON-LD deve conter Schema Product');
    assert.ok(htmlDetail.includes('Mesa de Pé de Galo Século XVIII em Mogno Maciço'));
    assert.ok(htmlDetail.includes('950.00'));

    // Critical security check: No cost leakage
    assert.ok(!htmlDetail.includes('Fornecedor Confidencial Silva'));
    assert.ok(!htmlDetail.includes('30000')); // acquisitionCents value
    assert.ok(!htmlDetail.includes('75000')); // minPriceCents value
  });

  it('8. Isolamento Multi-Tenant: Tenant B não pode ler ou modificar artigos do Tenant A', async () => {
    // Tenant B attempts to read item from Tenant A
    const resForbidden = await app.inject({
      method: 'GET',
      url: `/api/sellmais/items/${createdItemId}`,
      headers: { authorization: `Bearer ${tokenB}` }
    });

    assert.equal(resForbidden.statusCode, 404, 'Tenant B não deve encontrar ou aceder a artigos do Tenant A');

    // Tenant B attempts to transition item from Tenant A
    const transForbidden = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${createdItemId}/transition`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { toStatus: 'AVAILABLE' }
    });

    assert.equal(transForbidden.statusCode, 404, 'Tenant B não deve conseguir alterar artigos do Tenant A');
  });
});
