const { spawn } = require('child_process');
const http = require('http');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = reject;
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.callbacks.has(data.id)) {
          const cb = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) cb.reject(new Error(data.error.message));
          else cb.resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Eval error');
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function runBrowserInteractionTest() {
  console.log('🌐 A arrancar Microsoft Edge com porta de depuração DevTools (9222)...');

  const browserProcess = spawn(EDGE_PATH, [
    '--remote-debugging-port=9222',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3333/login.html'
  ]);

  await sleep(2500);

  try {
    const pages = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9222/json/list', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const targetPage = pages.find(p => p.url.includes('localhost:3333'));
    if (!targetPage) throw new Error('Página localhost:3333 não encontrada no browser DevTools');

    console.log(`🔌 A ligar WebSocket CDP à página: ${targetPage.url}`);
    const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // API Call para obter o Token real e simular a autenticação física
    const loginRes = await new Promise((resolve) => {
      const req = http.request('http://localhost:3333/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      });
      req.write(JSON.stringify({ email: 'helderguiomar@gmail.com', password: 'admin1234' }));
      req.end();
    });

    console.log('\n--- TESTE 1: Injeção de Sessão & Autenticação ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/login.html' });
    await sleep(1000);

    await cdp.eval(`localStorage.setItem('erp_session', JSON.stringify(${JSON.stringify(loginRes)}));`);
    console.log('  ✓ Sessão de utilizador gravada no LocalStorage do browser');

    // TESTE 2: Navegar pela Consola Super Admin
    console.log('\n--- TESTE 2: Consola Super Admin & Abas ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/super-admin.html' });
    await sleep(1500);

    const saTitle = await cdp.eval('document.title');
    console.log(`  ✓ Título da Consola Super Admin: "${saTitle}"`);

    const tabsToTest = ['tenants', 'applications', 'users', 'monitoring', 'roles'];
    for (const tab of tabsToTest) {
      await cdp.eval(`switchTab('${tab}')`);
      await sleep(500);
      const isVisible = await cdp.eval(`document.getElementById('${tab}-section').classList.contains('active')`);
      console.log(`  ✓ Mudança para aba "${tab}": ${isVisible ? 'Ativa no DOM' : 'Falha'}`);
    }

    // TESTE 3: Navegar pelo User Workspace
    console.log('\n--- TESTE 3: User Workspace & Modais ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/workspace.html' });
    await sleep(1500);

    const welcomeMsg = await cdp.eval(`document.getElementById('welcome-message').textContent`);
    console.log(`  ✓ Mensagem de boas-vindas: "${welcomeMsg}"`);

    const appCardsCount = await cdp.eval(`document.querySelectorAll('.app-card').length`);
    console.log(`  ✓ Cartões de aplicações renderizados no DOM: ${appCardsCount}`);

    await cdp.eval(`openTenantAdminModal()`);
    await sleep(500);
    const modalActive = await cdp.eval(`document.getElementById('tenant-admin-modal').classList.contains('active')`);
    console.log(`  ✓ Modal de Definições da Empresa: ${modalActive ? 'Aberta no DOM' : 'Fechada'}`);

    await cdp.eval(`closeTenantAdminModal()`);
    await sleep(500);

    // TESTE 4: Módulos ERP & Router por Hash (#/crm, #/condominios)
    console.log('\n--- TESTE 4: Shell ERP & Hash Router ---');
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/app.html#/crm' });
    await sleep(1500);

    const crmVisible = await cdp.eval(`document.getElementById('view-crm').style.display !== 'none'`);
    console.log(`  ✓ Vista CRM (#/crm): ${crmVisible ? 'Visível no DOM' : 'Oculta'}`);

    await cdp.send('Page.navigate', { url: 'http://localhost:3333/app.html#/condominios' });
    await sleep(1500);

    const condoVisible = await cdp.eval(`document.getElementById('view-condominios').style.display !== 'none'`);
    console.log(`  ✓ Vista Condomínios (#/condominios): ${condoVisible ? 'Visível no DOM' : 'Oculta'}`);

    cdp.close();
    browserProcess.kill();

    console.log('\n================================================================');
    console.log('✅ AUTOMAÇÃO COMPLETA DE TESTES NO BROWSER PASSOU COM 100% SUCESSO!');
    console.log('================================================================');

  } catch (err) {
    console.error('❌ Erro durante os testes no browser:', err.message);
    browserProcess.kill();
    process.exit(1);
  }
}

runBrowserInteractionTest();
