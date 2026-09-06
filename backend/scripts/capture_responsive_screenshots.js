const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\helde\\.gemini\\antigravity\\brain\\4bd57fbc-e50c-4312-80ab-c48db336a3a1';

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

  async captureScreenshot(filename, width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile
    });
    await sleep(800);
    const shot = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    const buffer = Buffer.from(shot.data, 'base64');
    const targetPath = path.join(ARTIFACT_DIR, filename);
    fs.writeFileSync(targetPath, buffer);
    console.log(` 📸 Capturado: ${filename} (${width}x${height}) -> ${targetPath}`);
    return targetPath;
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('🌐 A arrancar Edge Headless para capturar evidências visuais de responsividade...');
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

    // 1. Landing Page Mobile
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/index.html' });
    await cdp.captureScreenshot('landing_mobile_preview.jpg', 375, 812, true);

    // 2. Landing Page Desktop
    await cdp.captureScreenshot('landing_desktop_preview.jpg', 1440, 900, false);

    // 3. Super Admin Mobile
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/super-admin.html' });
    await cdp.captureScreenshot('super_admin_mobile_preview.jpg', 375, 812, true);

    // 4. ERP App Desktop
    await cdp.send('Page.navigate', { url: 'http://localhost:3333/app.html#/crm' });
    await cdp.captureScreenshot('app_desktop_preview.jpg', 1440, 900, false);

    cdp.close();
    console.log('✅ Captura de screenshots concluída com sucesso!');
  } catch (err) {
    console.error('❌ Erro de captura:', err);
  } finally {
    browserProcess.kill();
  }
}

run();
