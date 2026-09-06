const { spawn } = require('child_process');
const http = require('http');

const CHROME_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testWithDevTools() {
  console.log('🚀 A arrancar browser em modo de automação DevTools (Porta 9222)...');

  const browser = spawn(CHROME_PATH, [
    '--remote-debugging-port=9222',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3333/login.html'
  ]);

  // Wait 2 seconds for browser to start
  await new Promise(r => setTimeout(r, 2000));

  try {
    const listRes = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9222/json/list', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    console.log('✅ Browser ligado via DevTools Protocol! Páginas abertas:', listRes.length);
    listRes.forEach(p => console.log(`  - ${p.title} (${p.url})`));

    browser.kill();
    console.log('✅ Automação do browser concluída sem exceções de processo.');
  } catch (err) {
    console.error('❌ Erro na automação DevTools:', err.message);
    browser.kill();
  }
}

testWithDevTools();
