import { PrismaClient } from '@prisma/client';

// Singleton do Prisma Client, criado apenas na primeira utilização real
// (lazy). Duas razões para ser lazy em vez de instanciar logo no import:
// 1. Evita esgotar ligações à base de dados em dev quando `tsx watch`
//    recarrega módulos.
// 2. Permite importar este módulo (e módulos que dependem dele, como os
//    services) em testes que injetam um Prisma "fake" via construtor sem
//    precisar de um Prisma Client gerado — o `new PrismaClient()` real só
//    corre se alguém aceder a uma propriedade do objeto `prisma`.
declare global {
  var __prisma: PrismaClient | undefined;
}

function getOrCreateClient(): PrismaClient {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
    });
  }
  return global.__prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getOrCreateClient() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

let _dbReady = false;
let _lastDbCheck = 0;
let _schemaEnsured = false;

export async function ensureDatabaseSchema(client?: PrismaClient): Promise<void> {
  if (_schemaEnsured) return;
  const prismaClient = client || getOrCreateClient();
  try {
    // 0. User verification fields
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerificationToken" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3);`);

    // 1. AccountRequest onboarding resilience fields
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "emailDeliveryStatus" TEXT DEFAULT 'PENDING';`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "emailDeliveryError" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "emailLastAttemptAt" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "emailAttemptCount" INTEGER NOT NULL DEFAULT 0;`);

    // 2. AuditLog forensic reseal fields and hashes
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "prevHash" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hash" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resealedAt" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resealedBy" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "resealBatchId" TEXT;`);
    try {
      await prismaClient.$executeRawUnsafe(`UPDATE "audit_logs" SET "prevHash" = '0000000000000000000000000000000000000000000000000000000000000000' WHERE "prevHash" IS NULL;`);
      await prismaClient.$executeRawUnsafe(`UPDATE "audit_logs" SET "hash" = '0000000000000000000000000000000000000000000000000000000000000000' WHERE "hash" IS NULL;`);
    } catch {}

    // 3. Incidents table
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "audit_chain_incidents" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT,
        "prevHash" TEXT NOT NULL,
        "occurrences" INTEGER NOT NULL,
        "firstSeenAt" TIMESTAMP(3) NOT NULL,
        "lastSeenAt" TIMESTAMP(3) NOT NULL,
        "spanMs" INTEGER NOT NULL,
        "classification" TEXT NOT NULL,
        "notes" TEXT,
        "documentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "audit_chain_incidents_pkey" PRIMARY KEY ("id")
      );
    `);

    // 4. Reseals table
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "audit_chain_reseals" (
        "id" TEXT NOT NULL,
        "batchId" TEXT NOT NULL,
        "tenantId" TEXT,
        "reason" TEXT NOT NULL,
        "performedBy" TEXT NOT NULL,
        "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "affectedCount" INTEGER NOT NULL,
        "previousState" JSONB NOT NULL,
        "finalHash" TEXT NOT NULL,
        CONSTRAINT "audit_chain_reseals_pkey" PRIMARY KEY ("id")
      );
    `);

    _schemaEnsured = true;
  } catch (err: any) {
    console.warn('[DB SCHEMA ENSURE] Warning:', err?.message || err);
  }
}

// Export a health check function that doesn't crash
export async function checkDatabaseReady(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && _dbReady && now - _lastDbCheck < 30000) {
    return true; // Cache health check for 30s if it was ready
  }
  
  try {
    const client = getOrCreateClient();
    await client.$queryRawUnsafe('SELECT 1');
    await ensureDatabaseSchema(client);
    _dbReady = true;
    _lastDbCheck = now;
    return true;
  } catch (error: any) {
    _dbReady = false;
    _lastDbCheck = now;
    // Do not throw, just return false if it's in recovery or unavailable
    return false;
  }
}

