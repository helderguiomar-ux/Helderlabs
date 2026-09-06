import { execSync } from 'child_process';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../.env') });

const prodUrl = process.env.PROD_DATABASE_URL || process.argv[2];

if (!prodUrl) {
  console.error('\n\x1b[41m ERRO \x1b[0m PROD_DATABASE_URL não fornecida.');
  console.error('USO: PROD_DATABASE_URL="<neon_url>" npm run db:mirror\n');
  process.exit(1);
}

const localUrl = process.env.DATABASE_URL || '';
const localHost = (() => { try { return new URL(localUrl).hostname; } catch { return ''; } })();
if (!['localhost', '127.0.0.1', 'postgres', 'host.docker.internal'].includes(localHost)) {
  console.error('\n\x1b[41m ABORTADO \x1b[0m O destino do espelho tem de ser a base de dados LOCAL.');
  process.exit(1);
}

console.log('🔄 A iniciar espelhamento de produção para local...');
console.log('1/3 A efetuar pg_dump da produção...');
const dumpFile = join(__dirname, '../../backups/prod_mirror_temp.dump');

try {
  execSync(`pg_dump "${prodUrl}" -F c -b -v -f "${dumpFile}"`, { stdio: 'inherit' });
  console.log('2/3 A restaurar dump na base de dados local...');
  execSync(`pg_restore --clean --if-exists --no-owner --no-acl -d "${localUrl}" "${dumpFile}"`, { stdio: 'inherit' });
  console.log('3/3 A aplicar script de anonimização (anonymize.sql)...');
  const sqlFile = join(__dirname, 'anonymize.sql');
  execSync(`psql "${localUrl}" -f "${sqlFile}"`, { stdio: 'inherit' });
  console.log('\n\x1b[32m✓\x1b[0m Espelhamento e anonimização concluídos com sucesso!');
} catch (err) {
  console.error('\n\x1b[41m ERRO \x1b[0m Falha durante o espelhamento:', err.message);
  process.exit(1);
}
