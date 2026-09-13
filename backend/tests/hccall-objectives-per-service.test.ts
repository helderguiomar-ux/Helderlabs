import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { HccallProductService } from '../src/modules/hccall/services/HccallProductService';
import { HccallObjectiveService } from '../src/modules/hccall/services/HccallObjectiveService';
import { HccallSaleService } from '../src/modules/hccall/services/HccallSaleService';

const prisma = new PrismaClient();

describe('HCCALL — Objetivos por Serviço Vendido', () => {
  const tenantId = 'test-tenant-objectives';
  const userId = 'test-user-obj';

  before(async () => {
    // Setup test tenant and user if needed
    const existingTenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existingTenant) {
      await prisma.tenant.create({
        data: {
          id: tenantId,
          name: 'Tenant de Teste Objetivos',
          slug: 'tenant-test-obj'
        }
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: userId,
          tenantId,
          email: 'test-obj@helderlabs.com',
          name: 'Operador Objetivos',
          passwordHash: 'dummy-hash'
        }
      });
    }
  });

  after(async () => {
    // Cleanup test records
    await prisma.hccallSaleItem.deleteMany({ where: { tenantId } });
    await prisma.hccallSaleEvent.deleteMany({ where: { tenantId } });
    await prisma.hccallSaleChange.deleteMany({ where: { tenantId } });
    await prisma.hccallSale.deleteMany({ where: { tenantId } });
    await prisma.hccallObjective.deleteMany({ where: { tenantId } });
    await prisma.hccallProduct.deleteMany({ where: { tenantId } });
  });

  it('deve criar um serviço com objetivo mensal associado automaticamente', async () => {
    const prod = await HccallProductService.createProduct(prisma, tenantId, userId, {
      name: 'Fibra Ótica 10Gbps',
      sku: 'FIBRA_10G',
      category: 'Telecomunicações',
      baseValueCents: 5000,
      defaultCommissionCents: 2500,
      monthlyTarget: 12
    });

    assert.equal(prod.name, 'Fibra Ótica 10Gbps');
    assert.equal(prod.monthlyTarget, 12);

    const objs = await HccallObjectiveService.listObjectives(prisma, tenantId, userId);
    const objFibra = objs.find(o => o.productId === prod.id);

    assert.ok(objFibra, 'Objetivo do serviço deve existir');
    assert.equal(objFibra.targetValue, 12);
    assert.equal(objFibra.type, 'PRODUCT_COUNT');
    assert.equal(objFibra.product?.name, 'Fibra Ótica 10Gbps');
  });

  it('deve atualizar o progresso do objetivo específico ao registar uma venda desse serviço', async () => {
    const prod = await prisma.hccallProduct.findFirst({
      where: { tenantId, userId, name: 'Fibra Ótica 10Gbps' }
    });
    assert.ok(prod);

    // Registar venda do produto
    const res = await HccallSaleService.createSale(prisma, tenantId, userId, {
      productId: prod.id,
      quantity: 3,
      customerNumber: 'CLI-8899',
      customerName: 'Cliente Teste Objetivos',
      soldAt: new Date()
    });

    assert.ok(res.sale);
    assert.equal(res.sale.items.length, 1);
    assert.equal(res.sale.items[0].productId, prod.id);

    // Verificar listagem de objetivos
    const objs = await HccallObjectiveService.listObjectives(prisma, tenantId, userId);
    const objFibra = objs.find(o => o.productId === prod.id);

    assert.ok(objFibra);
    assert.equal(objFibra.currentValue, 3, 'Current value deve refletir as 3 unidades vendidas');
    assert.equal(objFibra.pace.percentAchieved, 25, '3 de 12 é 25%');
  });
});
