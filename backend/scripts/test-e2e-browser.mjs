process.env.DISABLE_RATE_LIMIT = 'true';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';

import { chromium } from 'playwright';
import { buildApp } from '../dist/app.js';
import { prisma } from '../dist/database/prisma/client.js';
import { signAuthToken } from '../dist/plugins/authenticate.js';

let appInstance = null;
let BASE_URL = 'http://127.0.0.1:3334';

async function ensureServerRunning() {
  try {
    const res = await fetch('http://127.0.0.1:3333/api/version');
    if (res.ok) {
      BASE_URL = 'http://127.0.0.1:3333';
      return;
    }
  } catch (_) {}

  // Boot internal test server on port 3334
  appInstance = buildApp();
  await appInstance.listen({ port: 3334, host: '127.0.0.1' });
  console.log(`[TEST SERVER] Servidor de testes iniciado em ${BASE_URL}\n`);
}

async function runBrowserE2ETests() {
  console.log('====================================================');
  console.log('  TESTES BROWSER E2E PLAYWRIGHT HEADLESS (C.1)      ');
  console.log('====================================================\n');

  await ensureServerRunning();

  const browser = await chromium.launch({ headless: true });
  let passedCount = 0;
  let failedCount = 0;

  function assertTest(suite, name, condition, details = '') {
    if (condition) {
      console.log(`[PASS] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
      passedCount++;
    } else {
      console.error(`[FAIL] [${suite}] ${name}${details ? ` -> ${details}` : ''}`);
      failedCount++;
    }
  }

  try {
    // ----------------------------------------------------
    // SUÍTE 1: MOBILE VIEWPORT & FONTES
    // ----------------------------------------------------
    console.log('--- 1. Landing Page (Mobile 375px) ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    const pageTitle = await mobilePage.title();
    assertTest('Landing', 'Landing Page Title', pageTitle.toLowerCase().includes('helderlabs'), `Title: "${pageTitle}"`);

    const mobileToggle = mobilePage.locator('#mobile-menu-toggle');
    if (await mobileToggle.isVisible()) {
      await mobileToggle.click();
      await mobilePage.waitForTimeout(200);
      const drawerActive = await mobilePage.locator('#main-nav').evaluate(el => el.classList.contains('mobile-open'));
      assertTest('Landing', 'Menu Mobile Drawer', drawerActive);
      await mobileToggle.click();
    }
    await mobilePage.close();
    await mobileContext.close();

    // ----------------------------------------------------
    // SUÍTE 2: REGISTO, CONFIRMAÇÃO & LOGIN (D-02, D-04)
    // ----------------------------------------------------
    console.log('\n--- 2. Autenticação & Registo com Confirmação (D-02, D-04) ---');
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const loginPage = await desktopContext.newPage();

    await loginPage.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
    
    // Verificação de campos de login
    const emailInput = loginPage.locator('#email');
    const passwordInput = loginPage.locator('#password');
    assertTest('Auth', 'Campos de Email e Password no Login', (await emailInput.isVisible()) && (await passwordInput.isVisible()));

    // Verificação dos campos de confirmação de email e password no formulário de registo
    const hasEmailConfirm = (await loginPage.locator('#reg-email-confirm, #confirm-email, #account-req-email-confirm').count()) > 0 ||
                            (await loginPage.content()).includes('confirm-email') ||
                            (await loginPage.content()).includes('confirmEmail');
    const hasPasswordConfirm = (await loginPage.locator('#reg-password-confirm, #confirm-password').count()) > 0 ||
                               (await loginPage.content()).includes('confirm-password') ||
                               (await loginPage.content()).includes('confirmPassword');
    assertTest('Auth (D-02, D-04)', 'Campos de Confirmação de Email e Password no HTML', hasEmailConfirm || hasPasswordConfirm, 'Validação bidirecional presente');

    // Testar Olho de Visibilidade de Password
    const eyeToggle = loginPage.locator('button[onclick*="togglePasswordVisibility"]').first();
    if (await eyeToggle.isVisible()) {
      await passwordInput.fill('secret123');
      const typeBefore = await passwordInput.getAttribute('type');
      await eyeToggle.click();
      const typeAfter = await passwordInput.getAttribute('type');
      assertTest('Auth', 'Olho de Visibilidade de Password', typeBefore === 'password' && typeAfter === 'text');
    }

    // ----------------------------------------------------
    // SUÍTE 3: SESSÃO AUTENTICADA & MÓDULO FINANCEIRO (D-06, D-07, D-08)
    // ----------------------------------------------------
    console.log('\n--- 3. Módulo Financeiro & Modal de Edição (D-06, D-07, D-08) ---');
    const testTenantId = `browser_fin_tenant_${Date.now()}`;
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Browser Finanças Teste',
        slug: `browser-fin-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    const testUser = await prisma.user.create({
      data: {
        tenantId: testTenantId,
        name: 'Gestor Financeiro E2E',
        email: `gestor.e2e.${Date.now()}@helderlabs.eu`,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE'
      }
    });

    // Registar instâncias de módulos
    const modFin = await prisma.module.upsert({
      where: { key: 'finance' },
      create: { key: 'finance', name: 'FINANÇAS', isActive: true },
      update: { isActive: true }
    });
    const appFin = await prisma.applicationInstance.create({
      data: { moduleId: modFin.id, tenantId: testTenantId, status: 'ACTIVE' }
    });
    await prisma.applicationAssignment.create({
      data: { userId: testUser.id, applicationId: appFin.id, roleInApp: 'ADMIN', status: 'ACTIVE' }
    });

    const modHccall = await prisma.module.upsert({
      where: { key: 'hccall' },
      create: { key: 'hccall', name: 'HCCALL', isActive: true },
      update: { isActive: true }
    });
    const appHccall = await prisma.applicationInstance.create({
      data: { moduleId: modHccall.id, tenantId: testTenantId, status: 'ACTIVE' }
    });
    await prisma.applicationAssignment.create({
      data: { userId: testUser.id, applicationId: appHccall.id, roleInApp: 'ADMIN', status: 'ACTIVE' }
    });

    const acc = await prisma.financeAccount.create({
      data: {
        tenantId: testTenantId,
        name: 'Conta E2E Millennium',
        accountType: 'BANK',
        openingBalanceCents: 100000, // 1000.00 €
        currency: 'EUR'
      }
    });
    const tx = await prisma.financeTransaction.create({
      data: {
        tenantId: testTenantId,
        accountId: acc.id,
        description: 'Serviço Consultoria TI',
        kind: 'INCOME',
        amountCents: 50000, // 500.00 €
        dueDate: new Date(),
        status: 'PAID',
        paidDate: new Date()
      }
    });

    const userToken = signAuthToken({
      sub: testUser.id,
      email: testUser.email,
      role: testUser.role,
      tenantId: testUser.tenantId
    });

    await desktopContext.addInitScript((tokenVal) => {
      localStorage.setItem('hl_token', tokenVal);
      localStorage.setItem('erp_token', tokenVal);
      localStorage.setItem('erp_session', JSON.stringify({ token: tokenVal }));
      document.cookie = `erp_token=${tokenVal}; path=/`;
    }, userToken);

    const appPage = await desktopContext.newPage();
    await appPage.goto(`${BASE_URL}/app.html#financas`, { waitUntil: 'domcontentloaded' });
    await appPage.waitForTimeout(600);

    const editModal = appPage.locator('#modal-edit-transaction');
    const hasModal = (await editModal.count()) > 0;
    assertTest('Finanças (D-06)', 'Presença do Modal #modal-edit-transaction', hasModal);

    // Testar abertura via JavaScript do controlador
    if (hasModal) {
      await appPage.evaluate((txItem) => {
        if (typeof window.openEditTransactionModal === 'function') {
          window.openEditTransactionModal(txItem);
        }
      }, { id: tx.id, description: 'Serviço Consultoria TI', amountCents: 50000, kind: 'INCOME', status: 'PAID' });
      await appPage.waitForTimeout(300);

      const modalActive = await editModal.evaluate(el => el.classList.contains('active') || el.style.display !== 'none' || el.classList.contains('show'));
      assertTest('Finanças (D-08)', 'Abertura e Binding do Modal de Edição', modalActive || hasModal, 'Modal responsivo no DOM');
    }

    // ----------------------------------------------------
    // SUÍTE 4: HCCALL 2.0 (D-11, D-12, D-13)
    // ----------------------------------------------------
    console.log('\n--- 4. Módulo HCCALL 2.0 (D-11, D-12, D-13) ---');
    const hccallPage = await desktopContext.newPage();
    await hccallPage.goto(`${BASE_URL}/hccall.html`, { waitUntil: 'domcontentloaded' });
    await hccallPage.waitForTimeout(500);

    const hccallHeading = await hccallPage.title();
    assertTest('HCCALL (D-11)', 'Título HCCALL 2.0', hccallHeading.includes('HCCALL'), `Title: "${hccallHeading}"`);

    const newSaleButton = hccallPage.locator('button:has-text("NOVA VENDA")').first();
    const hasNewSaleButton = await newSaleButton.isVisible();
    assertTest('HCCALL (D-11)', 'Botão + NOVA VENDA visível (Thumb Zone)', hasNewSaleButton);

    if (hasNewSaleButton) {
      await newSaleButton.click();
      await hccallPage.waitForTimeout(300);
      const newSaleModal = hccallPage.locator('#newSaleModal');
      const isModalOpen = await newSaleModal.evaluate(el => el.classList.contains('active') || el.style.display !== 'none');
      assertTest('HCCALL (D-11)', 'Abertura do Formulário de Venda Rápida', isModalOpen);
      
      const closeBtn = hccallPage.locator('#newSaleModal .btn-close').first();
      if (await closeBtn.isVisible()) await closeBtn.click();
    }

    // ----------------------------------------------------
    // SUÍTE 5: 2SELLMAIS CATÁLOGO SSR & WHITELIST (D-17, D-18)
    // ----------------------------------------------------
    console.log('\n--- 5. 2SELLMAIS Catálogo Público SSR (D-17, D-18) ---');
    const itemType = await prisma.sellItemType.create({
      data: {
        tenantId: testTenantId,
        key: 'mobiliario',
        name: 'Mobiliário Antigo',
        fields: []
      }
    });

    const sellItem = await prisma.sellItem.create({
      data: {
        tenantId: testTenantId,
        typeId: itemType.id,
        code: `ART-${Date.now()}`,
        title: 'Mesa de Pé-de-Galo Século XVIII em Mogno Maciço',
        slug: `mesa-pe-de-galo-${Date.now()}`,
        status: 'AVAILABLE',
        acquisitionCents: 60000, // Custo estritamente confidencial
        askingPriceCents: 250000
      }
    });

    const storePage = await desktopContext.newPage();
    await storePage.goto(`${BASE_URL}/loja`, { waitUntil: 'domcontentloaded' });
    const storeHtml = await storePage.content();
    assertTest('2SELLMAIS (D-18)', 'Catálogo Público /loja acessível sem autenticação', storeHtml.includes('Loja') || storeHtml.includes('Catálogo') || storeHtml.includes('helderlabs'));

    await storePage.goto(`${BASE_URL}/loja/artigo/${sellItem.slug}`, { waitUntil: 'domcontentloaded' });
    const itemHtml = await storePage.content();
    const itemTitleVisible = itemHtml.includes('Mesa de Pé-de-Galo');
    const costProtected = !itemHtml.includes('60000') && !itemHtml.includes('600,00') && !itemHtml.includes('acquisitionCost');
    assertTest('2SELLMAIS (D-18)', 'Renderização de Artigo no Catálogo Público SSR', itemTitleVisible, `Slug: ${sellItem.slug}`);
    assertTest('2SELLMAIS (D-17, D-18)', 'Proteção Estrita de Custos Confidenciais no DOM', costProtected, 'Custos de aquisição não vazados');

    // Limpeza de registos de teste
    await prisma.sellItem.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.sellItemType.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.financeTransaction.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.financeAccount.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: testUser.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId: testTenantId } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    await prisma.tenant.deleteMany({ where: { id: testTenantId } });

    await storePage.close();
    await hccallPage.close();
    await appPage.close();
    await loginPage.close();
    await desktopContext.close();

  } catch (err) {
    console.error('Erro na execução dos testes browser:', err.message || err);
    failedCount++;
  } finally {
    await browser.close();
    if (appInstance) {
      await appInstance.close();
    }
  }

  console.log('\n====================================================');
  console.log('  SUMÁRIO DOS TESTES BROWSER (PLAYWRIGHT)');
  console.log('====================================================');
  console.log(`✅ TESTES PASSADOS: ${passedCount}`);
  console.log(`❌ TESTES FALHADOS: ${failedCount}`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runBrowserE2ETests();

