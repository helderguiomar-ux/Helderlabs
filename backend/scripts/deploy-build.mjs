import { execSync } from 'child_process';

console.log('[BUILD] 1/3: Executando Prisma Generate...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
} catch (e) {
  console.error('[BUILD ERROR] Falha no Prisma Generate:', e.message);
  throw e;
}

console.log('[BUILD] 2/3: Executando Bootstrap de Produção (Módulos & Super Admin)...');
try {
  execSync('npx tsx scripts/prod-bootstrap.ts', { stdio: 'inherit' });
} catch (e) {
  console.warn('[BUILD WARNING] Aviso no bootstrap:', e.message);
}

console.log('[BUILD] 3/3: Compilando TypeScript...');
try {
  execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
} catch (e) {
  console.error('[BUILD ERROR] Falha no TypeScript build:', e.message);
  throw e;
}

console.log('[BUILD] Concluído com sucesso!');

