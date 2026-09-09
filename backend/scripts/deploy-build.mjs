import { execSync } from 'child_process';

console.log('[BUILD] Executando Prisma Generate...');
execSync('npx prisma generate', { stdio: 'inherit' });

console.log('[BUILD] Aplicando migrações na base de dados (Prisma Migrate Deploy)...');
execSync('npx prisma migrate deploy', { stdio: 'inherit' });

console.log('[BUILD] Executando Bootstrap de Produção (Módulos & Super Admin)...');
try {
  execSync('npx tsx scripts/prod-bootstrap.ts', { stdio: 'inherit' });
} catch (e) {
  console.warn('[BUILD] Aviso no bootstrap:', e.message);
}

console.log('[BUILD] Compilando TypeScript...');
execSync('npm run build', { stdio: 'inherit' });
console.log('[BUILD] Concluído com sucesso!');
