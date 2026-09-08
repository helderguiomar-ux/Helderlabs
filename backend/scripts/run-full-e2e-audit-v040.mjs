import { buildApp } from '../src/app.ts';
import { prisma } from '../src/database/prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

async function runE2EAudit() {
  console.log('========================================================================');
  console.log('  AUDITORIA E2E COMPLETA — HELDERLABS ERP v0.4.0');
  console.log('  Verificação de Ponta a Ponta: DB, API, Finanças, CRM 360º, Auditoria SHA256');
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
    // SUITE 1: INFRAESTRUTURA & BASE DE DADOS
    // -----------------------------------------------------------------------
    console.log('\n--- 1. Infraestrutura & Estado da Base de Dados ---');
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    const healthData = JSON.parse(healthRes.payload);
    assert('1. Infraestrutura', 'GET /api/health responde 200', healthRes.statusCode === 200);
    assert('1. Infraestrutura', 'Database status é "ready"', healthData.database === 'ready');
    assert('1. Infraestrutura', 'Application status é "healthy"', healthData.application === 'healthy');

    // -----------------------------------------------------------------------
    // SUITE 2: AUTENTICAÇÃO, UTILIZADORES & WORKSPACE MANIFEST
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Autenticação & Workspace Manifest ---');
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

    const workspaceRes = await app.inject({
      method: 'GET',
      url: '/api/me/workspace',
      headers: authHeaders
    });
    const workspaceData = JSON.parse(workspaceRes.payload);
    assert('2. Autenticação & Sessão', 'GET /api/me/workspace responde 200', workspaceRes.statusCode === 200);
    assert('2. Autenticação & Sessão', 'Manifesto identifica tenant e user', workspaceData.user?.email === superAdmin.email);
    assert('2. Autenticação & Sessão', 'Módulos licenciados presentes no manifesto', Array.isArray(workspaceData.modules));

    // -----------------------------------------------------------------------
    // SUITE 3: GESTÃO FINANCEIRA (COCKPIT, PROJEÇÃO 90D, TRANSAÇÕES, SOFT DELETE)
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Módulo Financeiro & Motor Matemático (Cêntimos Inteiros) ---');

    // 3.1 KPIs
    const kpiRes = await app.inject({
      method: 'GET',
      url: '/api/financas/dashboard',
      headers: authHeaders
    });
    const kpiData = JSON.parse(kpiRes.payload);
    assert('3. Finanças', 'GET /api/financas/dashboard responde 200', kpiRes.statusCode === 200);
    assert('3. Finanças', '6 KPIs canónicos calculados em cêntimos inteiros', 
      typeof kpiData.kpis?.currentBalanceCents === 'number' &&
      typeof kpiData.kpis?.totalIncomeCents === 'number' &&
      typeof kpiData.kpis?.totalExpenseCents === 'number' &&
      typeof kpiData.kpis?.netResultCents === 'number' &&
      typeof kpiData.kpis?.committedCents === 'number' &&
      typeof kpiData.kpis?.availableBalanceCents === 'number'
    );

    // 3.2 Projeção a 90 dias
    const projRes = await app.inject({
      method: 'GET',
      url: '/api/financas/projections?days=90',
      headers: authHeaders
    });
    const projData = JSON.parse(projRes.payload);
    assert('3. Finanças', 'GET /api/financas/projections?days=90 responde 200', projRes.statusCode === 200);
    assert('3. Finanças', 'Projeção calcula 90 pontos diários e saldo final', 
      projData.days === 90 &&
      Array.isArray(projData.dailyPoints) &&
      projData.dailyPoints.length >= 90
    );

    // 3.3 Criação, Pagamento, Soft-Delete e Restauro de Transação
    const createTxRes = await app.inject({
      method: 'POST',
      url: '/api/financas/transactions',
      headers: authHeaders,
      payload: {
        description: 'E2E Teste Auditoria Despesa Licença',
        kind: 'EXPENSE',
        amountCents: 15000, // 150.00 EUR
        dueDate: new Date().toISOString(),
        status: 'PLANNED',
        counterpartyName: 'Vendor E2E Test Lda'
      }
    });
    const createTxData = JSON.parse(createTxRes.payload);
    assert('3. Finanças', 'POST /api/financas/transactions cria movimento', createTxRes.statusCode === 201);
    const txId = createTxData.transaction?.id;

    // Liquidar
    const payRes = await app.inject({
      method: 'PATCH',
      url: `/api/financas/transactions/${txId}/pay`,
      headers: authHeaders,
      payload: { isPaid: true }
    });
    const payData = JSON.parse(payRes.payload);
    assert('3. Finanças', 'PATCH /api/financas/transactions/:id/pay liquida transação', payData.transaction?.status === 'PAID');

    // Soft-Delete
    const delTxRes = await app.inject({
      method: 'DELETE',
      url: `/api/financas/transactions/${txId}`,
      headers: authHeaders
    });
    assert('3. Finanças', 'DELETE /api/financas/transactions/:id efetua soft-delete', delTxRes.statusCode === 200);

    // Restauro
    const restoreTxRes = await app.inject({
      method: 'POST',
      url: `/api/financas/transactions/${txId}/restore`,
      headers: authHeaders
    });
    assert('3. Finanças', 'POST /api/financas/transactions/:id/restore recupera registo', restoreTxRes.statusCode === 200);

    // -----------------------------------------------------------------------
    // SUITE 4: CRM EMPRESA 360º (PERFIL, COMPLETUDE, CONTACTOS, CONTRATOS)
    // -----------------------------------------------------------------------
    console.log('\n--- 4. CRM Empresa 360º & Completude Progressiva ---');

    // 4.1 Criar Empresa 360º
    const createCompRes = await app.inject({
      method: 'POST',
      url: '/api/crm/companies',
      headers: authHeaders,
      payload: {
        tradeName: 'HelderLabs Inovação E2E',
        legalName: 'HelderLabs Inovação Tecnológica Lda',
        taxNumber: 'PT509999888',
        status: 'CUSTOMER',
        email: 'e2e@helderlabs.eu',
        phone: '+351210000999',
        sector: 'Software & Engenharia',
        address: 'Parque Tecnológico de Lisboa'
      }
    });
    const createCompData = JSON.parse(createCompRes.payload);
    assert('4. CRM Empresa 360º', 'POST /api/crm/companies cria empresa', createCompRes.statusCode === 201);
    const compId = createCompData.company?.id;

    // 4.2 Obter Perfil 360º com Completude
    const getCompRes = await app.inject({
      method: 'GET',
      url: `/api/crm/companies/${compId}`,
      headers: authHeaders
    });
    const getCompData = JSON.parse(getCompRes.payload);
    assert('4. CRM Empresa 360º', 'GET /api/crm/companies/:id retorna perfil 360º', getCompRes.statusCode === 200);
    assert('4. CRM Empresa 360º', 'Cálculo de completude percentual presente (>50%)', getCompData.company?.completenessPercent >= 50);

    // 4.3 Adicionar Contacto
    const addContactRes = await app.inject({
      method: 'POST',
      url: `/api/crm/companies/${compId}/contacts`,
      headers: authHeaders,
      payload: {
        name: 'Dra. Joana Silva',
        role: 'Diretora Financeira (CFO)',
        email: 'joana.silva@empresa.pt',
        isPrimary: true,
        decisionPower: 'DECISION_MAKER'
      }
    });
    assert('4. CRM Empresa 360º', 'POST /api/crm/companies/:id/contacts adiciona decisor', addContactRes.statusCode === 201);

    // 4.4 Adicionar Contrato SLA
    const addContractRes = await app.inject({
      method: 'POST',
      url: `/api/crm/companies/${compId}/contracts`,
      headers: authHeaders,
      payload: {
        contractNumber: 'CTR-2026-E2E-001',
        title: 'Contrato Anual Suporte & Manutenção Enterprise',
        monthlyValueCents: 125000, // 1,250.00 EUR/mês
        startDate: '2026-09-01',
        status: 'ACTIVE'
      }
    });
    assert('4. CRM Empresa 360º', 'POST /api/crm/companies/:id/contracts cria contrato', addContractRes.statusCode === 201);

    // -----------------------------------------------------------------------
    // SUITE 5: AUDITORIA TRANSVERSAL & INTEGRIDADE CRIPTOGRÁFICA SHA-256
    // -----------------------------------------------------------------------
    console.log('\n--- 5. Auditoria Transversal & Rastreabilidade SHA-256 ---');

    // 5.1 Verificar integridade da cadeia de hashes
    const verifyChainRes = await app.inject({
      method: 'GET',
      url: '/api/platform/audit-chain/verify',
      headers: authHeaders
    });
    const verifyChainData = JSON.parse(verifyChainRes.payload);
    assert('5. Auditoria Transversal', 'GET /api/platform/audit-chain/verify responde 200', verifyChainRes.statusCode === 200);
    assert('5. Auditoria Transversal', 'Cadeia SHA-256 é 100% válida e íntegra (valid: true)', verifyChainData.valid === true);

    // 5.2 Dashboard de Auditoria
    const auditDashRes = await app.inject({
      method: 'GET',
      url: '/api/platform/audit/dashboard',
      headers: authHeaders
    });
    const auditDashData = JSON.parse(auditDashRes.payload);
    assert('5. Auditoria Transversal', 'Dashboard de auditoria regista mutações e módulos', 
      auditDashData.totalLogs > 0 && Array.isArray(auditDashData.moduleStats)
    );

    // -----------------------------------------------------------------------
    // SUITE 6: FRONTEND MODULAR & ATIVOS ESTÁTICOS
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Frontend Caderno de Engenharia & Ativos Estáticos ---');
    const staticPages = [
      { path: '/app.html', requiredContent: 'HelderLabs ERP' },
      { path: '/assets/css/app.css', requiredContent: '--surface-1' },
      { path: '/assets/js/finance.js', requiredContent: 'FinanceModule' },
      { path: '/assets/js/crm.js', requiredContent: 'CRMModule' },
      { path: '/assets/js/audit.js', requiredContent: 'AuditModule' },
      { path: '/assets/js/modules.js', requiredContent: 'MODULES_REGISTRY' }
    ];

    for (const p of staticPages) {
      const res = await app.inject({ method: 'GET', url: p.path });
      assert('6. Frontend & Ativos', `GET ${p.path} responde 200`, res.statusCode === 200);
      assert('6. Frontend & Ativos', `${p.path} contém código/conteúdo esperado`, res.payload.includes(p.requiredContent));
    }

    // -----------------------------------------------------------------------
    // SUMÁRIO FINAL
    // -----------------------------------------------------------------------
    console.log('\n========================================================================');
    console.log(`  RESULTADO DA AUDITORIA E2E: ${results.passed}/${results.total} TESTES APROVADOS (${results.failed} FALHAS)`);
    if (results.failed > 0) {
      console.log('  TESTES COM FALHA:');
      for (const suite of results.suites) {
        for (const test of suite.tests) {
          if (test.status === 'FAIL') {
            console.log(`  ❌ [${suite.name}] ${test.name}`);
          }
        }
      }
    }
    console.log('========================================================================\n');

    process.exit(results.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n[FATAL AUDIT ERROR]', err);
    process.exit(1);
  }
}

runE2EAudit();
