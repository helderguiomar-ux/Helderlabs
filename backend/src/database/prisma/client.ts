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
  // eslint-disable-next-line no-var
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
    // 1. Column users fields
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roleId" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isOnline" BOOLEAN NOT NULL DEFAULT false;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionToken" TEXT;`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" TEXT;`);
    
    // 2. Column tenants fields
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`);
    await prismaClient.$executeRawUnsafe(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "entitlementsVersion" INTEGER NOT NULL DEFAULT 1;`);
    
    // 3. Table roles
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "baseRole" "UserRole" NOT NULL DEFAULT 'USER',
        "deletedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
      );
    `);
    
    // 4. Index on roles
    await prismaClient.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenantId_key_key" ON "roles"("tenantId", "key");`);
    
    // 5. Table role_permission_links
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "role_permission_links" (
        "id" TEXT NOT NULL,
        "roleId" TEXT NOT NULL,
        "permissionName" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "role_permission_links_pkey" PRIMARY KEY ("id")
      );
    `);
    
    // 6. Index on role_permission_links
    await prismaClient.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "role_permission_links_roleId_permissionName_key" ON "role_permission_links"("roleId", "permissionName");`);

    _schemaEnsured = true;
  } catch (error: any) {
    // Safe fallback: do not throw to allow queries to continue
    console.warn('[DB SCHEMA ENSURE] Warning during runtime schema ensure:', error?.message || error);
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

