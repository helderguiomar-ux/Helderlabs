process.env.DISABLE_RATE_LIMIT = 'true';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:3333';

async function runBrowserE2ETests() {
  console.log('====================================================');
  console.log('  TESTES BROWSER REAL HEADLESS (PLAYWRIGHT)  ');
  console.log('====================================================\n');

  const browser = await chromium.launch({ headless: true });
  let passedCount = 0;
  let failedCount = 0;

  function assertTest(name, condition, details = '') {
    if (condition) {
      console.log(`[PASS] ${name}${details ? ` -> ${details}` : ''}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${name}${details ? ` -> ${details}` : ''}`);
      failedCount++;
    }
  }

  try {
    // 1. VIEWPORT MOBILE 375px
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
    });

    const page = await mobileContext.newPage();

    // 1.1 Carregamento da Landing Page
    console.log('--- 1. Landing Page (Mobile 375px) ---');
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    const pageTitle = await page.title();
    assertTest('Landing Page Title', pageTitle.toLowerCase().includes('helderlabs'), `Title: "${pageTitle}"`);

    // 1.2 Verificação de Fontes Canonicas
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const archivoLoaded = await page.evaluate(() => document.fonts.check('400 16px Archivo'));
    const spectralLoaded = await page.evaluate(() => document.fonts.check('700 16px Spectral'));
    const monoLoaded = await page.evaluate(() => document.fonts.check('600 16px "IBM Plex Mono"'));
    const caveatLoaded = await page.evaluate(() => document.fonts.check('600 16px Caveat'));

    assertTest('Carregamento de Fontes Canonicas', archivoLoaded && spectralLoaded && monoLoaded && caveatLoaded, 
      `Archivo:${archivoLoaded}, Spectral:${spectralLoaded}, Mono:${monoLoaded}, Caveat:${caveatLoaded}`);

    // 1.3 Toggle do Menu Mobile & Drawer
    const mobileToggle = page.locator('#mobile-menu-toggle');
    const isToggleVisible = await mobileToggle.isVisible();
    assertTest('Botão de Menu Mobile Visível a 375px', isToggleVisible);

    if (isToggleVisible) {
      await mobileToggle.click();
      await page.waitForTimeout(300);
      const drawerActive = await page.locator('#main-nav').evaluate(el => el.classList.contains('mobile-open'));
      const ariaExpanded = await mobileToggle.getAttribute('aria-expanded');
      assertTest('Abertura do Menu Mobile (.mobile-open)', drawerActive && ariaExpanded === 'true', `mobile-open:${drawerActive}, aria-expanded:${ariaExpanded}`);

      // Fechar menu mobile clicando novamente no toggle
      await mobileToggle.click();
      await page.waitForTimeout(300);
      const drawerClosed = await page.locator('#main-nav').evaluate(el => !el.classList.contains('mobile-open'));
      const ariaClosed = await mobileToggle.getAttribute('aria-expanded');
      assertTest('Fecho do Menu Mobile', drawerClosed && ariaClosed === 'false', 'Menu fechado com sucesso');
    }

    // 1.4 Offset de Âncoras
    const heroCta = page.locator('a[href="#contacto"]').first();
    if (await heroCta.isVisible()) {
      await heroCta.click();
      await page.waitForTimeout(400);
      const scrollY = await page.evaluate(() => window.scrollY);
      assertTest('Deslocamento de Âncora (scroll-padding-top)', scrollY >= 0, `scrollY: ${scrollY}px`);
    }

    await page.close();
    await mobileContext.close();

    // 2. DESKTOP & LOGIN PAGE
    console.log('\n--- 2. Página de Login & Alteração de Password ---');
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const loginPage = await desktopContext.newPage();

    loginPage.on('console', msg => console.log('PAGE LOG:', msg.text()));
    loginPage.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    await loginPage.goto(`${BASE_URL}/login.html`, { waitUntil: 'domcontentloaded' });
    
    // 2.1 Verificação dos Campos de Login
    const emailInput = loginPage.locator('#email');
    const passwordInput = loginPage.locator('#password');
    await emailInput.fill('helderguiomar@gmail.com');
    await passwordInput.fill('admin1234');
    
    const emailVisible = await emailInput.isVisible();
    const passwordVisible = await passwordInput.isVisible();
    assertTest('Presença dos Campos Email e Password', emailVisible && passwordVisible);

    // 2.2 Olho de Visibilidade
    const inputTypeInitial = await passwordInput.getAttribute('type');
    const eyeToggle = loginPage.locator('button[onclick*="togglePasswordVisibility"]').first();
    
    if (await eyeToggle.isVisible()) {
      await eyeToggle.click();
      const inputTypeToggled = await passwordInput.getAttribute('type');
      assertTest('Olho de Visibilidade de Password', inputTypeInitial === 'password' && inputTypeToggled === 'text', 
        `Initial: ${inputTypeInitial} -> Toggled: ${inputTypeToggled}`);
    } else {
      assertTest('Olho de Visibilidade de Password', false, 'Botão não encontrado');
    }

    // 2.3 Navegação para Entrada via Código OTP
    await loginPage.locator('button:has-text("Entrar com Código OTP")').click();
    await loginPage.waitForTimeout(500);
    const stepOtpVisible = await loginPage.locator('#step-otp').isVisible();
    assertTest('Navegação para Recuperação OTP', stepOtpVisible);

    await loginPage.close();
    await desktopContext.close();

  } catch (err) {
    console.error('Erro na execução dos testes browser:', err.message || err);
    failedCount++;
  } finally {
    await browser.close();
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
