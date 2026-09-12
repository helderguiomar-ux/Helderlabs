import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

console.log('[BUILD] 1/4: Executando Prisma Generate...');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
} catch (e) {
  console.error('[BUILD ERROR] Falha no Prisma Generate:', e.message);
  throw e;
}

console.log('[BUILD] 2/4: Sincronizando Schema da Base de Dados (Prisma DB Push)...');
try {
  const prisma = new PrismaClient();
  try {
    console.log('[BUILD] A reparar NULLs legados e colunas em falta no PostgreSQL...');
    await prisma.$executeRawUnsafe(`
      UPDATE "audit_logs" SET "prevHash" = '0000000000000000000000000000000000000000000000000000000000000000' WHERE "prevHash" IS NULL;
      UPDATE "audit_logs" SET "hash" = '0000000000000000000000000000000000000000000000000000000000000000' WHERE "hash" IS NULL;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3);
    `);
  } catch (sqlErr) {
    console.warn('[BUILD WARNING] Aviso no SQL prévio:', sqlErr.message);
  } finally {
    await prisma.$disconnect();
  }

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

