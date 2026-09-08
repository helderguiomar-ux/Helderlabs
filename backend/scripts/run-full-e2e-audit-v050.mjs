import { buildApp } from '../src/app.ts';
import { prisma } from '../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

async function runE2EAudit() {
  console.log('========================================================================');
  console.log('  AUDITORIA E2E COMPLETA — HELDERLABS ERP v0.5.0');
  console.log('  Verificação Total: Finanças, CRM 360º, HCCALL, 2SELLMAIS, SSR & SHA256');
  console.log('========================================================================\n');

  const app = buildApp();
  await app.ready();

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    suites: []
  };

  function assert(suiteName, testName, condition, details = '') {
    results.total++;
    let currentSuite = results.suites.find(s => s.name === suiteName);
    if (!currentSuite) {
      currentSuite = { name: suiteName, tests: [] };
      results.suites.push(currentSuite);
    }

    if (condition) {
      results.passed++;
      currentSuite.tests.push({ name: testName, status: 'PASS', details });
      console.log(`  [PASS] [${suiteName}] ${testName}${details ? ` -> ${details}` : ''}`);
    } else {
      results.failed++;
      currentSuite.tests.push({ name: testName, status: 'FAIL', details });
      console.error(`  [FAIL] [${suiteName}] ${testName}${details ? ` -> ${details}` : ''}`);
    }
  }

  try {
    // -----------------------------------------------------------------------
    // SUITE 1: INFRAESTRUTURA & SAÚDE
    // -----------------------------------------------------------------------
    console.log('\n--- 1. Infraestrutura & Saúde ---');
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    const healthData = JSON.parse(healthRes.payload);
    assert('1. Infraestrutura', 'GET /api/health responde 200', healthRes.statusCode === 200);
    assert('1. Infraestrutura', 'Database status é "ready"', healthData.database === 'ready');
    assert('1. Infraestrutura', 'Application status é "healthy"', healthData.application === 'healthy');

    // -----------------------------------------------------------------------
    // SUITE 2: AUTENTICAÇÃO & SESSÃO SUPER_ADMIN
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Autenticação & Sessão ---');
    let superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, include: { tenant: true } });
    if (!superAdmin) {
      const defaultTenant = await prisma.tenant.findFirst() || await prisma.tenant.create({
        data: { name: 'HelderLabs Holding', slug: 'helderlabs-platform', status: 'ACTIVE' }
      });
      const passwordHash = await bcrypt.hash('admin1234', 10);
      superAdmin = await prisma.user.create({
        data: {
          email: 'helderguiomar@gmail.com',
          name: 'Helder Nobrega',
          passwordHash,
          role: 'SUPER_ADMIN',
          tenantId: defaultTenant.id,
          status: 'ACTIVE'
        },
        include: { tenant: true }
      });
    }

    // License hccall and sellmais if not licensed
    const modHccall = await prisma.module.findUnique({ where: { key: 'hccall' } });
    if (modHccall) {
      await prisma.applicationInstance.upsert({
        where: { tenantId_moduleId: { tenantId: superAdmin.tenantId, moduleId: modHccall.id } },
        create: { tenantId: superAdmin.tenantId, moduleId: modHccall.id, status: 'ACTIVE' },
        update: { status: 'ACTIVE' }
      });
    }

    const modSellmais = await prisma.module.findUnique({ where: { key: 'sellmais' } });
    if (modSellmais) {
      await prisma.applicationInstance.upsert({
        where: { tenantId_moduleId: { tenantId: superAdmin.tenantId, moduleId: modSellmais.id } },
        create: { tenantId: superAdmin.tenantId, moduleId: modSellmais.id, status: 'ACTIVE' },
        update: { status: 'ACTIVE' }
      });
    }

    const token = jwt.sign(
      {
        sub: superAdmin.id,
        email: superAdmin.email,
        role: superAdmin.role,
        tenantId: superAdmin.tenantId
      },
      process.env.JWT_SECRET || 'jwt_secret_dev_local_only',
      { expiresIn: '1h' }
    );
    const authHeaders = { authorization: `Bearer ${token}` };

    const workspaceRes = await app.inject({ method: 'GET', url: '/api/me/workspace', headers: authHeaders });
    assert('2. Autenticação & Sessão', 'GET /api/me/workspace responde 200', workspaceRes.statusCode === 200);

    // -----------------------------------------------------------------------
    // SUITE 3: HCCALL TELECOM (PWA, PROMOÇÕES, VENDAS, SNAPSHOT IMUTÁVEL)
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Módulo HCCALL Telecom ---');
    const hccallServicesRes = await app.inject({ method: 'GET', url: '/api/hccall/services', headers: authHeaders });
    assert('3. HCCALL Telecom', 'GET /api/hccall/services responde 200', hccallServicesRes.statusCode === 200);
    const services = JSON.parse(hccallServicesRes.payload).services || [];
    assert('3. HCCALL Telecom', 'Lista serviços padrão', services.length > 0);

    const serviceId = services[0]?.id;
    const promoRes = await app.inject({
      method: 'POST',
      url: '/api/hccall/promotions',
      headers: authHeaders,
      payload: {
        name: 'Campanha Fibra Audit v0.5.0',
        serviceId,
        suggestedCommissionCents: 4500,
        promoValueCents: 2999
      }
    });
    assert('3. HCCALL Telecom', 'Criação de dinamização comercial (201)', promoRes.statusCode === 201);
    const promo = JSON.parse(promoRes.payload).promotion;

    // Registo de Venda com Snapshot
    const clientUuid = `audit-sale-${Date.now()}`;
    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/hccall/sales',
      headers: authHeaders,
      payload: {
        clientUuid,
        customerNumber: `CLI-${Date.now().toString().slice(-6)}`,
        customerName: 'Cliente Telecom Audit',
        serviceId,
        promotionId: promo.id,
        commissionCents: 4500,
        soldAt: new Date().toISOString()
      }
    });
    assert('3. HCCALL Telecom', 'Registo de venda com geração de código HCC (201)', saleRes.statusCode === 201);
    const sale = JSON.parse(saleRes.payload).sale;
    assert('3. HCCALL Telecom', 'Snapshot imutável gravado na venda', sale.promotionSnapshot?.suggestedCommissionCents === 4500);

    // Relatório de Comissões
    const repRes = await app.inject({ method: 'GET', url: '/api/hccall/reports/commissions', headers: authHeaders });
    assert('3. HCCALL Telecom', 'Relatório de comissões por estado responde 200', repRes.statusCode === 200);

    // -----------------------------------------------------------------------
    // SUITE 4: 2SELLMAIS (INVENTÁRIO, CUSTOS, MÁQUINA DE ESTADOS, LEILÕES)
    // -----------------------------------------------------------------------
    console.log('\n--- 4. Módulo 2SELLMAIS ---');
    const typesRes = await app.inject({ method: 'GET', url: '/api/sellmais/types', headers: authHeaders });
    assert('4. 2SELLMAIS', 'GET /api/sellmais/types responde 200', typesRes.statusCode === 200);
    const types = JSON.parse(typesRes.payload).types || [];
    assert('4. 2SELLMAIS', 'Tipos padrão criados (relogio, mobiliario, pintura, joia, vinil)', types.length >= 4);

    const typeId = types[0]?.id;
    const createItemRes = await app.inject({
      method: 'POST',
      url: '/api/sellmais/items',
      headers: authHeaders,
      payload: {
        title: 'Escrivaninha D. Maria em Pau-Santo Século XVIII',
        typeId,
        acquisitionType: 'PURCHASE',
        acquisitionCents: 50000, // 500.00 €
        askingPriceCents: 140000, // 1400.00 €
        description: 'Exemplar museológico do período neoclássico português.',
        attributes: { madeira: 'Pau-Santo', estilo: 'D. Maria', gavetas: 5, restaurado: false }
      }
    });
    assert('4. 2SELLMAIS', 'Criação de artigo com atributos JSONB e ref ART- (201)', createItemRes.statusCode === 201);
    const item = JSON.parse(createItemRes.payload).item;

    // Adicionar custo de restauro
    const addCostRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${item.id}/costs`,
      headers: authHeaders,
      payload: {
        category: 'RESTORATION',
        description: 'Tratamento de verniz de boneca tradicional',
        amountCents: 15000, // 150.00 €
        supplierName: 'Restaurador de Arte Antiga'
      }
    });
    assert('4. 2SELLMAIS', 'Adição de custo de restauro (201)', addCostRes.statusCode === 201);

    // Verificar materialização total de custos (500€ + 150€ = 650€)
    const itemDetailRes = await app.inject({ method: 'GET', url: `/api/sellmais/items/${item.id}`, headers: authHeaders });
    const itemDetail = JSON.parse(itemDetailRes.payload).item;
    assert('4. 2SELLMAIS', 'Materialização do custo total (500€ + 150€ = 650€)', itemDetail.totalCostCents === 65000);

    // Transição de Estado: DRAFT -> AVAILABLE
    const transRes = await app.inject({
      method: 'POST',
      url: `/api/sellmais/items/${item.id}/transition`,
      headers: authHeaders,
      payload: { targetState: 'AVAILABLE' }
    });
    assert('4. 2SELLMAIS', 'Transição válida DRAFT -> AVAILABLE (200)', transRes.statusCode === 200);

    // -----------------------------------------------------------------------
    // SUITE 5: CATÁLOGO PÚBLICO SSR & WHITELIST DE DADOS
    // -----------------------------------------------------------------------
    console.log('\n--- 5. Catálogo Público SSR & Whitelist ---');
    const storeRes = await app.inject({ method: 'GET', url: '/loja' });
    assert('5. Catálogo SSR', 'GET /loja responde 200 text/html', storeRes.statusCode === 200 && storeRes.headers['content-type']?.includes('text/html'));
    assert('5. Catálogo SSR', 'Artigo disponível listado na montra', storeRes.payload.includes('Escrivaninha D. Maria'));

    const itemSsrRes = await app.inject({ method: 'GET', url: `/loja/artigo/${item.slug}` });
    assert('5. Catálogo SSR', 'GET /loja/artigo/:slug responde 200', itemSsrRes.statusCode === 200);
    assert('5. Catálogo SSR', 'Contém dados estruturados Schema.org JSON-LD', itemSsrRes.payload.includes('application/ld+json'));
    assert('5. Catálogo SSR', 'Whitelist de segurança: sem fuga de custo de aquisição (50000)', !itemSsrRes.payload.includes('50000'));
    assert('5. Catálogo SSR', 'Whitelist de segurança: sem fuga de fornecedor confidencial', !itemSsrRes.payload.includes('Restaurador de Arte Antiga'));

    // -----------------------------------------------------------------------
    // SUITE 6: AUDITORIA TRANSVERSAL SHA-256
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Auditoria Transversal SHA-256 ---');
    const auditRes = await app.inject({ method: 'GET', url: '/api/platform/audit/logs', headers: authHeaders });
    assert('6. Auditoria SHA-256', 'GET /api/platform/audit/logs responde 200', auditRes.statusCode === 200);
    const auditLogs = JSON.parse(auditRes.payload).logs || [];
    assert('6. Auditoria SHA-256', 'Registos de auditoria gravados', auditLogs.length > 0);

  } catch (err) {
    console.error('ERRO INESPERADO NA AUDITORIA:', err);
  } finally {
    console.log('\n========================================================================');
    console.log(`  RESUMO DA AUDITORIA E2E v0.5.0:`);
    console.log(`  Total: ${results.total} | Aprovados: ${results.passed} | Falhas: ${results.failed}`);
    console.log('========================================================================\n');
    process.exit(results.failed > 0 ? 1 : 0);
  }
}

runE2EAudit();
