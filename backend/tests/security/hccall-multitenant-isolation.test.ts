import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/database/prisma/client';
import { HccallSaleService } from '../../src/modules/hccall/services/HccallSaleService';
import { HccallCommissionEngine } from '../../src/modules/hccall/services/HccallCommissionEngine';
import { HccallIntegrityService } from '../../src/modules/hccall/services/HccallIntegrityService';
import { HccallProductService } from '../../src/modules/hccall/services/HccallProductService';
import { HccallDynamizationService } from '../../src/modules/hccall/services/HccallDynamizationService';

describe('HCCALL Multi-Tenant Isolation, State Machine & Production Hardening', () => {
  const tenantA = 'test-tenant-isolation-a';
  const tenantB = 'test-tenant-isolation-b';
  const userA = 'test-user-a';
  const userB = 'test-user-b';

  before(async () => {
    // 1. Criar tenants de teste
    await prisma.tenant.upsert({
      where: { id: tenantA },
      create: { id: tenantA, name: 'Tenant A Teste', slug: 'tenant-a-test' },
      update: {}
    });
    await prisma.tenant.upsert({
      where: { id: tenantB },
      create: { id: tenantB, name: 'Tenant B Teste', slug: 'tenant-b-test' },
      update: {}
    });

    // 2. Criar utilizadores de teste
    await prisma.user.upsert({
      where: { id: userA },
      create: { id: userA, tenantId: tenantA, email: 'user-a@test.com', name: 'User A', role: 'USER' },
      update: {}
    });
    await prisma.user.upsert({
      where: { id: userB },
      create: { id: userB, tenantId: tenantB, email: 'user-b@test.com', name: 'User B', role: 'USER' },
      update: {}
    });
  });

  after(async () => {
    // Limpeza de registos de teste
    try {
      await prisma.hccallSaleEvent.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallSaleItem.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallSaleChange.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallSale.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallDynamizationTier.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallDynamizationBonus.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallDynamization.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.hccallProduct.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    } catch (_) {}
  });

  it('1. Deve impedir IDOR transitivo: Tenant B não consegue usar produto de Tenant A', async () => {
    // Produto criado no Tenant A
    const prodA = await HccallProductService.createProduct(prisma, tenantA, userA, {
      name: 'Fibra 1Gbps Tenant A',
      baseValueCents: 5000,
      defaultCommissionCents: 1500
    });

    // Tenant B tenta criar venda referenciando prodA
    await assert.rejects(
      async () => {
        await HccallSaleService.createSale(prisma, tenantB, userB, {
          productId: prodA.id,
          quantity: 1,
          soldAt: new Date()
        });
      },
      /não encontrado ou pertence a outro tenant/i
    );
  });

  it('2. Deve impedir IDOR transitivo: Tenant B não consegue usar dinamização de Tenant A', async () => {
    const dynA = await HccallDynamizationService.createDynamization(prisma, tenantA, userA, {
      name: 'Campanha Especial Tenant A',
      startsAt: new Date(),
      tiers: [{ minQuantity: 1, maxQuantity: 10, unitAmountCents: 2000 }]
    });

    const prodB = await HccallProductService.createProduct(prisma, tenantB, userB, {
      name: 'Produto B',
      baseValueCents: 3000
    });

    await assert.rejects(
      async () => {
        await HccallSaleService.createSale(prisma, tenantB, userB, {
          productId: prodB.id,
          dynamizationId: dynA.id,
          quantity: 1,
          soldAt: new Date()
        });
      },
      /não encontrada ou pertence a outro tenant/i
    );
  });

  it('3. Deve impedir leitura, edição ou eliminação cruzada de vendas entre tenants', async () => {
    const prodA = await HccallProductService.createProduct(prisma, tenantA, userA, {
      name: 'Serviço A Teste 3',
      baseValueCents: 4000
    });

    const { sale: saleA } = await HccallSaleService.createSale(prisma, tenantA, userA, {
      productId: prodA.id,
      quantity: 1,
      customerNumber: 'CLI-001-A',
      soldAt: new Date()
    });

    // Tenant B tenta ler a venda do Tenant A
    await assert.rejects(
      async () => {
        await HccallSaleService.getSaleById(prisma, tenantB, userB, saleA.id);
      },
      /Não tem permissão/i
    );

    // Tenant B tenta editar a venda do Tenant A
    await assert.rejects(
      async () => {
        await HccallSaleService.updateSale(prisma, tenantB, userB, saleA.id, { notes: 'Ataque IDOR' });
      },
      /Não tem permissão/i
    );

    // Tenant B tenta eliminar a venda do Tenant A
    await assert.rejects(
      async () => {
        await HccallSaleService.deleteSale(prisma, tenantB, userB, saleA.id, 'Motivo ilegítimo');
      },
      /Não tem permissão/i
    );
  });

  it('4. Deve suportar cálculo correto de comissões nos modos milestone vs accumulate', () => {
    const dynMilestone = {
      id: 'dyn-ms',
      name: 'Milestone Bonus',
      tierMode: 'RETROACTIVE' as const,
      bonusMode: 'milestone' as const,
      baseAmountPerSaleCents: 1000,
      tiers: [
        { minQuantity: 1, maxQuantity: 10, unitAmountCents: 1000 },
        { minQuantity: 11, maxQuantity: 20, unitAmountCents: 1500 }
      ],
      bonuses: [
        { thresholdCount: 5, bonusAmountCents: 5000 },
        { thresholdCount: 15, bonusAmountCents: 10000 }
      ]
    };

    // Vendas = 15:
    // Base = 15 * 1000 = 15.000
    // Tiers (RETROACTIVE @ tier 2) = 15 * 1500 = 22.500
    // Bónus milestone (apenas o mais alto = threshold 15) = 10.000
    // Total = 15.000 + 22.500 + 10.000 = 47.500 cents
    const resMilestone = HccallCommissionEngine.calculateDynamization(dynMilestone, 15);
    assert.equal(resMilestone.bonusCommissionCents, 10000);
    assert.equal(resMilestone.totalCommissionCents, 47500);

    const dynAccumulate = {
      ...dynMilestone,
      bonusMode: 'accumulate' as const
    };
    // Vendas = 15 no modo accumulate:
    // Bónus acumulados = threshold 5 (5000) + threshold 15 (10000) = 15.000
    // Total = 15.000 + 22.500 + 15.000 = 52.500 cents
    const resAccumulate = HccallCommissionEngine.calculateDynamization(dynAccumulate, 15);
    assert.equal(resAccumulate.bonusCommissionCents, 15000);
    assert.equal(resAccumulate.totalCommissionCents, 52500);
  });

  it('5. Máquina de estados: Venda com data futura fica scheduled e não conta até à transição', async () => {
    const prodA = await HccallProductService.createProduct(prisma, tenantA, userA, {
      name: 'Venda Futura Teste',
      baseValueCents: 2000
    });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    const { sale: futureSale } = await HccallSaleService.createSale(prisma, tenantA, userA, {
      productId: prodA.id,
      quantity: 1,
      soldAt: futureDate
    });

    assert.equal(futureSale.statusId, 'scheduled');
    assert.ok(futureSale.scheduledConfirmedAt);
    assert.equal(futureSale.closedAt, null);

    // Histórico de eventos criado
    const events = await prisma.hccallSaleEvent.findMany({
      where: { saleId: futureSale.id }
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'CREATED');
  });

  it('6. Soft Delete com deleteReason obrigatório e histórico em hccall_sale_events', async () => {
    const prodA = await HccallProductService.createProduct(prisma, tenantA, userA, {
      name: 'Venda Para Apagar',
      baseValueCents: 1000
    });

    const { sale } = await HccallSaleService.createSale(prisma, tenantA, userA, {
      productId: prodA.id,
      quantity: 1,
      soldAt: new Date()
    });

    const reason = 'Cliente desistiu do contrato dentro dos 14 dias legais';
    await HccallSaleService.deleteSale(prisma, tenantA, userA, sale.id, reason);

    const deletedInDb = await prisma.hccallSale.findUnique({ where: { id: sale.id } });
    assert.ok(deletedInDb?.deletedAt);
    assert.equal(deletedInDb?.deletedBy, userA);
    assert.equal(deletedInDb?.deleteReason, reason);

    const events = await prisma.hccallSaleEvent.findMany({
      where: { saleId: sale.id },
      orderBy: { timestamp: 'desc' }
    });
    assert.equal(events[0].action, 'SOFT_DELETED');
    assert.equal(events[0].reason, reason);
  });

  it('7. Imutabilidade da tabela audit_logs: Trigger PostgreSQL bloqueia UPDATE e DELETE', async () => {
    const log = await prisma.auditLog.findFirst({ where: { tenantId: 'cmtqabwsw0006ta1y84r5vog4' } });
    if (log) {
      await assert.rejects(
        async () => {
          await prisma.$executeRawUnsafe(`UPDATE "audit_logs" SET "hash" = 'tampered' WHERE id = '${log.id}';`);
        },
        /AUDIT_LOG_IMMUTABLE/
      );

      await assert.rejects(
        async () => {
          await prisma.$executeRawUnsafe(`DELETE FROM "audit_logs" WHERE id = '${log.id}';`);
        },
        /AUDIT_LOG_IMMUTABLE/
      );
    }
  });

  it('8. Teste dos 7 determinísticos de HccallIntegrityService no tenant principal', async () => {
    const result = await HccallIntegrityService.runIntegrityCheck('cmtqabwsw0006ta1y84r5vog4');
    assert.equal(result.passed, true);
    assert.equal(result.criticalFailuresCount, 0);
    assert.equal(result.warningsCount, 0);
    assert.equal(result.checks.length, 7);
  });
});
