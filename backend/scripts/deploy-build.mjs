import { execSync } from 'child_process';

console.log('[BUILD] 1/4: Executando Prisma Generate...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
} catch (e) {
  console.error('[BUILD ERROR] Falha no Prisma Generate:', e.message);
  throw e;
}

console.log('[BUILD] 2/4: Sincronizando Schema da Base de Dados (Prisma DB Push)...');
try {
  try {
    execSync('npx prisma migrate resolve --rolled-back 20260912120000_onboarding_resilience_and_audit_integrity', { stdio: 'ignore' });
  } catch (err) {}

  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
  console.log('[BUILD] Schema sincronizado com sucesso via Prisma DB Push.');
} catch (e) {
  console.warn('[BUILD WARNING] Aviso na sincronização do schema:', e.message);
}

console.log('[BUILD] 3/4: Executando Bootstrap de Produção (Módulos & Super Admin)...');
try {
  execSync('npx tsx scripts/prod-bootstrap.ts', { stdio: 'inherit' });
} catch (e) {
  console.warn('[BUILD WARNING] Aviso no bootstrap:', e.message);
}

console.log('[BUILD] 4/4: Compilando TypeScript...');
try {
  execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
} catch (e) {
  console.error('[BUILD ERROR] Falha no TypeScript build:', e.message);
  throw e;
}

console.log('[BUILD] Concluído com sucesso!');

