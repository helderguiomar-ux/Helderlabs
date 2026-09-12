/**
 * HelderLabs ERP — Cliente Local de Produção
 * ---------------------------------------------------------------------------
 * Serve os MESMOS ficheiros do cliente web (backend/public) a partir desta
 * máquina, configurados para falar com a API de produção por HTTPS.
 *
 * O que este processo NÃO faz, e não pode fazer:
 *   - não liga a nenhuma base de dados;
 *   - não conhece o DATABASE_URL nem qualquer credencial;
 *   - não valida autenticação, permissões ou tenant.
 *
 * Tudo isso vive no backend. Isto é um servidor de ficheiros estáticos com uma
 * única rota dinâmica: o config.js que diz às páginas onde está a API.
 *
 * Escuta apenas em 127.0.0.1 — nunca em 0.0.0.0. O cliente não é acessível a
 * partir da rede local.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'backend', 'public');

const PORT = Number(process.env.HELDERLABS_LOCAL_PORT || 3400);
const API_BASE = (process.env.HELDERLABS_API_URL || 'https://helderlabs.eu').replace(/\/$/, '');
const APP_VERSION = process.env.HELDERLABS_CLIENT_VERSION || '1.2.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

/**
 * Configuração injetada nas páginas. É aqui, e só aqui, que o cliente local
 * difere do cliente web: apiBaseUrl aponta para a produção em vez de vazio.
 */
function buildConfigJs() {
  const config = {
    apiBaseUrl: API_BASE,
    clientType: 'DESKTOP',
    appVersion: APP_VERSION,
    buildId: 'local',
    environment: 'production'
  };
  return `window.HELDERLABS_CONFIG = Object.freeze(${JSON.stringify(config)});\n`;
}

/** Impede que um pedido saia da pasta public por travessia de caminho. */
function safeResolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  const resolved = normalize(join(PUBLIC_DIR, clean));
  if (!resolved.startsWith(PUBLIC_DIR + sep) && resolved !== PUBLIC_DIR) return null;
  return resolved;
}

const server = createServer(async (req, res) => {
  const urlPath = req.url === '/' ? '/login.html' : req.url;

  // Única rota dinâmica.
  if (urlPath.split('?')[0] === '/assets/js/config.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(buildConfigJs());
  }

  // Diagnóstico do próprio cliente (não é a API).
  if (urlPath.split('?')[0] === '/__client/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      client: 'HelderLabs ERP Desktop',
      version: APP_VERSION,
      apiBaseUrl: API_BASE,
      port: PORT
    }));
  }

  const filePath = safeResolve(urlPath);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Pedido inválido.');
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Ficheiro não encontrado no cliente local.</p>');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERRO] A porta ${PORT} já está ocupada.`);
    console.error('       O HelderLabs ERP já pode estar a correr. Verifica a barra de tarefas.\n');
    process.exit(2);
  }
  console.error('\n[ERRO]', err.message, '\n');
  process.exit(1);
});

// 127.0.0.1 explicitamente: o cliente não fica exposto na rede local.
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  HelderLabs ERP — Cliente Local');
  console.log('  ──────────────────────────────────────────');
  console.log(`  Cliente : http://localhost:${PORT}`);
  console.log(`  API     : ${API_BASE}`);
  console.log(`  Versão  : ${APP_VERSION}`);
  console.log('');
  console.log('  Os dados são os de PRODUÇÃO. Fecha esta janela para terminar.');
  console.log('');
});
