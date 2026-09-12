/**
 * HelderLabs ERP — Launcher
 * ---------------------------------------------------------------------------
 * O que acontece a um duplo clique no ícone:
 *
 *   1. verifica que o Node existe e que os ficheiros do cliente estão no sítio;
 *   2. arranca o servidor local (ou reutiliza um já a correr);
 *   3. espera que responda;
 *   4. procura Edge, depois Chrome;
 *   5. abre uma janela em modo aplicação — sem barra de endereço nem separadores;
 *   6. fica a vigiar: quando a janela fecha, encerra o servidor.
 *
 * O utilizador não vê consola, não escreve comandos, não abre um editor.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PORT = Number(process.env.HELDERLABS_LOCAL_PORT || 3400);
const START_URL = `http://localhost:${PORT}/login.html`;
const PROFILE_DIR = join(
  process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
  'HelderLabsERP',
  'browser'
);

function fail(title, detail) {
  // Sem consola visível, um erro tem de aparecer numa caixa de diálogo.
  const msg = `${title}\\n\\n${detail}`.replace(/"/g, "'");
  spawn(
    'powershell',
    ['-NoProfile', '-Command',
      `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("${msg}", "HelderLabs ERP", 0, 16)`],
    { stdio: 'ignore', detached: true }
  ).unref();
  process.exit(1);
}

// --- 1. Pré-requisitos ------------------------------------------------------
const serverPath = join(__dirname, 'server.mjs');
const publicDir = join(ROOT, 'backend', 'public');

if (!existsSync(serverPath)) {
  fail('Instalação incompleta', `Não foi encontrado:\\n${serverPath}`);
}
if (!existsSync(join(publicDir, 'login.html'))) {
  fail(
    'Ficheiros do ERP não encontrados',
    `Esperava encontrar as páginas em:\\n${publicDir}\\n\\nO atalho aponta para a pasta certa do projeto?`
  );
}

// --- 2. Servidor local ------------------------------------------------------
async function isRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/__client/health`, {
      signal: AbortSignal.timeout(800)
    });
    return res.ok;
  } catch {
    return false;
  }
}

let serverProcess = null;

if (await isRunning()) {
  // Já está a correr — abre-se apenas uma janela nova.
} else {
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, HELDERLABS_LOCAL_PORT: String(PORT) }
  });
  serverProcess.on('error', (err) =>
    fail('Não foi possível arrancar o cliente local', err.message)
  );
}

// --- 3. Esperar que responda ------------------------------------------------
let ready = false;
for (let i = 0; i < 40; i++) {
  if (await isRunning()) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!ready) {
  if (serverProcess) serverProcess.kill();
  fail('O cliente local não arrancou', `A porta ${PORT} não respondeu em 10 segundos.`);
}

// --- 4. Encontrar um browser ------------------------------------------------
const PF = process.env['ProgramFiles'] || 'C:\\\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');

const candidates = [
  join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe')
];

const browser = candidates.find((p) => existsSync(p));

// --- 5. Abrir a janela ------------------------------------------------------
let windowProcess;

if (browser) {
  // --app= abre sem barra de endereço, sem separadores, sem menus.
  // --user-data-dir dá-lhe um perfil próprio: a sessão do ERP fica isolada do
  // browser pessoal, persiste entre arranques, e o processo vive exatamente o
  // tempo da janela — o que permite encerrar o servidor quando ela fecha.
  windowProcess = spawn(
    browser,
    [
      `--app=${START_URL}`,
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900'
    ],
    { stdio: 'ignore', windowsHide: false }
  );
} else {
  // Sem Edge nem Chrome: abre no browser por omissão, em janela normal.
  windowProcess = spawn('cmd', ['/c', 'start', '""', START_URL], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true
  });
  windowProcess.unref();
  // Sem controlo sobre a janela, o servidor fica a correr até ser terminado.
  process.exit(0);
}

// --- 6. Encerrar quando a janela fechar -------------------------------------
windowProcess.on('exit', () => {
  if (serverProcess) serverProcess.kill();
  process.exit(0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (serverProcess) serverProcess.kill();
    process.exit(0);
  });
}
