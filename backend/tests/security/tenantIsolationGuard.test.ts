import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/plugins/authenticate';
import { prisma } from '../../src/database/prisma/client';
import fs from 'node:fs';
import path from 'node:path';

describe('Mitigação de Isolamento Multi-Tenant & Prevenção de Fuga de Dados', () => {
  test('Empresa A não consegue aceder a registos da Empresa B pelo ID direto em módulos ativos/beta', async () => {
    const app = buildApp();

    // 1. Obter utilizador da Empresa A (Consultoria Alfa)
    const userA = await prisma.user.findFirst({
      where: { email: 'ana@consultoria-alfa.pt' }
    });
    assert.ok(userA, 'Utilizador da Empresa A deve existir no seed');

    // 2. Obter utilizador e tenant da Empresa B (HelderLabs ou outra)
    const tenantB = await prisma.tenant.findFirst({
      where: { id: { not: userA.tenantId } }
    });
    assert.ok(tenantB, 'Tenant B deve existir para teste de isolamento cruzado');

    const tokenA = signAuthToken({
      sub: userA.id,
      email: userA.email,
      role: userA.role,
      tenantId: userA.tenantId
    });

    // Testar Módulo CRM: Tentar ler Lead que pertence à Empresa B
    const leadB = await prisma.lead.findFirst({
      where: { tenantId: tenantB.id }
    });

    if (leadB) {
      const resCRM = await app.inject({
        method: 'GET',
        url: `/api/crm/leads/${leadB.id}`,
        headers: { authorization: `Bearer ${tokenA}` }
      });
      // Deve retornar 404 Not Found ou 403 Forbidden por isolamento de tenant
      assert.ok([403, 404].includes(resCRM.statusCode), `Empresa A não pode aceder ao lead ${leadB.id} da Empresa B (status: ${resCRM.statusCode})`);
    }

    // Testar Módulo Finanças: Tentar ler Movimento/Transação da Empresa B
    const txB = await prisma.financeTransaction.findFirst({
      where: { tenantId: tenantB.id }
    });

    if (txB) {
      const resFin = await app.inject({
        method: 'GET',
        url: `/api/financas/transactions/${txB.id}`,
        headers: { authorization: `Bearer ${tokenA}` }
      });
      assert.ok([403, 404].includes(resFin.statusCode), `Empresa A não pode aceder à transação ${txB.id} da Empresa B (status: ${resFin.statusCode})`);
    }

    await app.close();
  });

  test('Static AST Check: Nenhum controlador ou serviço importa PrismaClient cru fora do tenantScopedClient.ts', () => {
    const srcDir = path.join(process.cwd(), 'src');
    
    function scanFiles(dir: string): string[] {
      const results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results.push(...scanFiles(fullPath));
        } else if (file.endsWith('.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const files = scanFiles(srcDir);
    const forbiddenImports: string[] = [];

    for (const filePath of files) {
      const relative = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
      if (
        relative === 'src/database/prisma/client.ts' ||
        relative === 'src/database/prisma/tenantScopedClient.ts'
      ) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      if (/import\s+.*\bPrismaClient\b.*from\s+['"]@prisma\/client['"]/.test(content)) {
        forbiddenImports.push(relative);
      }
    }

    assert.deepEqual(forbiddenImports, [], `Ficheiros violam a regra de isolamento importando PrismaClient cru: ${forbiddenImports.join(', ')}`);
  });
});
