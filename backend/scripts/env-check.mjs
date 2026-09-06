import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env explicitly
config({ path: join(__dirname, '../.env') });

const examplePath = join(__dirname, '../.env.example');
const exampleContent = readFileSync(examplePath, 'utf8');

// Parse required keys from .env.example (ignore comments and empty lines)
const requiredKeys = exampleContent
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const eqIdx = line.indexOf('=');
    return eqIdx > -1 ? line.substring(0, eqIdx).trim() : null;
  })
  .filter(Boolean);

const missingKeys = [];

for (const key of requiredKeys) {
  if (process.env[key] === undefined || process.env[key] === '') {
    // RESEND_API_KEY and OAuth keys can be empty in dev, but their presence is checked for prod
    const isOptionalDevKey = [
      'RESEND_API_KEY',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'APPLE_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY'
    ].includes(key);

    if (!isOptionalDevKey) {
      missingKeys.push(key);
    }
  }
}

if (missingKeys.length > 0) {
  console.error('\n\x1b[41m ERRO DE CONFIGURAÇÃO DE AMBIENTE \x1b[0m');
  console.error('As seguintes variáveis de ambiente obrigatórias não estão definidas:');
  missingKeys.forEach(k => console.error(`  - ${k}`));
  console.error('\nVerifica o teu ficheiro backend/.env e compara com backend/.env.example.\n');
  process.exit(1);
}

console.log(`\x1b[32m✓\x1b[0m Paridade de variáveis de ambiente confirmada (${requiredKeys.length} chaves verificadas).`);
