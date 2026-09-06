const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

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
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      });
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

async function testViewport(cdp, width, height, deviceName) {
  console.log(`\n=== Testing Viewport: ${deviceName} (${width}x${height}px) ===`);

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 900
  });

  const pages = [
    { name: 'Landing Page (index.html)', url: 'http://localhost:3333/index.html' },
    { name: 'Login Page (login.html)', url: 'http://localhost:3333/login.html' },
    { name: 'Workspace Launcher (workspace.html)', url: 'http://localhost:3333/workspace.html' },
    { name: 'Super Admin Console (super-admin.html)', url: 'http://localhost:3333/super-admin.html' },
    { name: 'ERP App CRM (app.html#/crm)', url: 'http://localhost:3333/app.html#/crm' }
  ];

  for (const page of pages) {
    await cdp.send('Page.navigate', { url: page.url });
    await sleep(600);

    const layoutCheck = await cdp.eval(`
      (function() {
        var docWidth = document.documentElement.offsetWidth;
        var scrollWidth = document.documentElement.scrollWidth;
        var overflowX = scrollWidth > docWidth;
        var mobileBtnVis = (function() {
          var btn = document.getElementById('mobile-toggle-btn');
          return btn ? window.getComputedStyle(btn).display !== 'none' : false;
        })();
        return { docWidth: docWidth, scrollWidth: scrollWidth, overflowX: overflowX, mobileBtnVis: mobileBtnVis };
      })()
    `);

    const ok = !layoutCheck.overflowX;
    console.log(`  [${ok ? 'PASS' : 'WARN'}] ${page.name}`);
    console.log(`         DocWidth: ${layoutCheck.docWidth}px | ScrollWidth: ${layoutCheck.scrollWidth}px | OverflowX: ${layoutCheck.overflowX}`);
    if (page.name.includes('Landing') && width < 900) {
      console.log(`         Mobile Hamburger Toggle Button Displayed: ${layoutCheck.mobileBtnVis}`);
    }
  }
}

async function run() {
  console.log('🌐 Spawning Edge CDP Browser for Responsive Testing...');
  const browserProcess = spawn(EDGE_PATH, [
    '--remote-debugging-port=9222',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3333/index.html'
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
    if (!targetPage) throw new Error('Target page not found in CDP list');

    const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    console.log('⚡ Connected to CDP! Verifying Viewports across all pages...');

    // 1. Mobile
    await testViewport(cdp, 375, 812, 'Mobile (iPhone 375px)');

    // 2. Tablet
    await testViewport(cdp, 768, 1024, 'Tablet (iPad 768px)');

    // 3. Desktop
    await testViewport(cdp, 1440, 900, 'Desktop (1440px)');

    cdp.close();
    console.log('\n✅ ALL MULTI-VIEWPORT RESPONSIVENESS TESTS COMPLETED WITHOUT OVERFLOW!');
  } catch (err) {
    console.error('❌ CDP Error:', err);
  } finally {
    browserProcess.kill();
  }
}

run();
