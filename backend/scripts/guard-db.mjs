import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load backend/.env explicitly
config({ path: join(__dirname, '../.env') });

const url = process.env.DATABASE_URL ?? '';
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
})();

const allowedLocalHosts = ['localhost', '127.0.0.1', 'postgres', 'host.docker.internal'];
const isLocal = allowedLocalHosts.includes(host);

if (!isLocal) {
  console.error('\n\x1b[41m ABORTADO \x1b[0m Comando destrutivo/de alteração de schema contra base de dados NÃO-LOCAL.');
  console.error(`  Host alvo : ${host || '(indecifrável)'}`);
  console.error(`  Permitido : ${allowedLocalHosts.join(', ')}`);
  console.error('\n  Migrações em produção aplicam-se via `prisma migrate deploy` no pipeline de deploy,');
  console.error('  nunca a partir de uma máquina de desenvolvimento local.\n');
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m Base de dados local confirmada (${host}).`);
