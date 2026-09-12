/**
 * Arranca o ERP LOCALMENTE contra a base de dados ONLINE.
 *
 * Porque é que isto é um script próprio e não uma variável no .env:
 *
 *   O DATABASE_URL do .env é usado por TUDO — `prisma migrate`, `prisma db push`,
 *   o seed e a suite de testes. Apontá-lo para a base de dados online faria com
 *   que um `npm test` distraído escrevesse em produção, e um `npm run db:reset`
 *   a destruísse. O guard-db.mjs protege os comandos de schema, mas não pode
 *   proteger tudo.
 *
 *   Por isso o .env mantém-se LOCAL, a ligação online vive numa variável
 *   separada (ONLINE_DATABASE_URL) e só este comando a usa.
 */
import { spawn } from 'child_process';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

const onlineUrl = process.env.ONLINE_DATABASE_URL;
const readOnly = process.env.ONLINE_DB_READONLY === 'true';

if (!onlineUrl) {
  console.error('\n\x1b[41m ERRO \x1b[0m ONLINE_DATABASE_URL não definida no backend/.env');
  console.error('\n  Acrescenta ao backend/.env:');
  console.error('    ONLINE_DATABASE_URL="postgresql://...neon.tech/...?sslmode=require"');
  console.error('    ONLINE_DB_READONLY=true   # true se usares um utilizador só-de-leitura\n');
  process.exit(1);
}

let host = '';
try {
  host = new URL(onlineUrl).hostname;
} catch {
  host = '(indecifrável)';
}

if (['localhost', '127.0.0.1', 'postgres', 'host.docker.internal'].includes(host)) {
  console.error('\n\x1b[41m ERRO \x1b[0m ONLINE_DATABASE_URL aponta para uma base local. Usa `npm run dev`.\n');
  process.exit(1);
}

const banner = readOnly
  ? '\x1b[42m\x1b[30m BD ONLINE · SÓ LEITURA \x1b[0m'
  : '\x1b[41m BD ONLINE · LEITURA E ESCRITA \x1b[0m';

console.log('\n' + banner);
console.log(`  Host       : ${host}`);
console.log(`  Aplicação  : http://localhost:${process.env.PORT || 3333}`);
console.log(`  Modo       : ${readOnly ? 'só leitura (as escritas falham no servidor)' : '\x1b[31mESCRITA REAL EM PRODUÇÃO\x1b[0m'}`);

if (!readOnly) {
  console.log('\n  \x1b[33mTudo o que fizeres nesta sessão altera dados reais.\x1b[0m');
  console.log('  Cada pedido não-GET grava também na cadeia de auditoria de produção.');
  console.log('  Para ler sem risco, cria um utilizador só-de-leitura no Neon');
  console.log('  e define ONLINE_DB_READONLY=true.\n');
}

async function confirm() {
  if (process.env.ONLINE_DB_CONFIRM === 'always' || readOnly) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) =>
    rl.question('  Escreve "producao" para continuar: ', (a) => {
      rl.close();
      r(a);
    })
  );
  const norm = answer.trim().toLowerCase();
  return norm === 'producao' || norm === 'produção';
}

if (!(await confirm())) {
  console.error('\n  Cancelado.\n');
  process.exit(1);
}

console.log('\n  A arrancar...\n');

const child = spawn('npx', ['tsx', 'watch', 'src/server.ts'], {
  cwd: join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: onlineUrl,
    NODE_ENV: 'development',
    ENVIRONMENT: readOnly ? 'LOCAL_ONLINE_RO' : 'LOCAL_ONLINE_RW',
    // Nunca permitir o código OTP mestre contra dados reais.
    ALLOW_DEV_OTP: 'false',
    ALLOW_DEV_MASTER_OTP: 'false'
  }
});

child.on('exit', (code) => process.exit(code ?? 0));
