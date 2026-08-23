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

// Export a health check function that doesn't crash
export async function checkDatabaseReady(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && _dbReady && now - _lastDbCheck < 30000) {
    return true; // Cache health check for 30s if it was ready
  }
  
  try {
    const client = getOrCreateClient();
    await client.$queryRawUnsafe('SELECT 1');
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

