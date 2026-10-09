import test from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';

test('Fase B8 — Painel Executivo: Pipeline por Fase, Ponderação e Previsão Mensal', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Acme Corp',
      originSource: 'WEBSITE'
    }
  });

  // Criar 3 oportunidades
  // 1. Qualificação: 1000 EUR, 20%
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Projeto A',
      companyId: comp.id,
      stage: 'QUALIFICATION',
      estimatedValue: 1000,
      probability: 20,
      expectedCloseDate: new Date('2026-11-15')
    }
  });

  // 2. Proposta: 2000 EUR, 50%
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Projeto B',
      companyId: comp.id,
      stage: 'PROPOSAL',
      estimatedValue: 2000,
      probability: 50,
      expectedCloseDate: new Date('2026-11-20')
    }
  });

  // 3. Negociação: 5000 EUR, 80%
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Projeto C',
      companyId: comp.id,
      stage: 'NEGOTIATION',
      estimatedValue: 5000,
      probability: 80,
      expectedCloseDate: new Date('2026-12-10')
    }
  });

  const dashboard = await service.getExecutiveDashboard();

  // Total aberto: 1000 + 2000 + 5000 = 8000 EUR = 800000 cêntimos
  assert.equal(dashboard.pipeline.totalOpenValueCents, 800000);

  // Total ponderado: (1000*0.2) + (2000*0.5) + (5000*0.8) = 200 + 1000 + 4000 = 5200 EUR = 520000 cêntimos
  assert.equal(dashboard.pipeline.totalWeightedValueCents, 520000);

  // Previsão de Novembro (2026-11): 3000 EUR (300000 cents), ponderado 120000 cents
  const novForecast = dashboard.forecast.find((f: any) => f.month === '2026-11');
  assert.ok(novForecast);
  assert.equal(novForecast.count, 2);
  assert.equal(novForecast.totalValueCents, 300000);
  assert.equal(novForecast.weightedValueCents, 120000);
});

test('Fase B8 — Painel Executivo: Taxa de Ganho (Win Rate) e Ciclo Médio de Venda', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Beta Systems'
    }
  });

  const d1 = new Date('2026-01-01');
  const d2 = new Date('2026-01-11'); // 10 dias de ciclo

  // WON 1: ciclo 10 dias
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Deal Ganho 1',
      companyId: comp.id,
      stage: 'WON',
      estimatedValue: 3000,
      createdAt: d1,
      updatedAt: d2
    }
  });

  // WON 2: ciclo 20 dias
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Deal Ganho 2',
      companyId: comp.id,
      stage: 'WON',
      estimatedValue: 5000,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-21')
    }
  });

  // LOST: 1 deal
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Deal Perdido',
      companyId: comp.id,
      stage: 'LOST',
      estimatedValue: 2000
    }
  });

  const dashboard = await service.getExecutiveDashboard();

  // Win rate: 2 ganhos de 3 fechados = 66.7%
  assert.equal(dashboard.efficiency.wonCount, 2);
  assert.equal(dashboard.efficiency.lostCount, 1);
  assert.equal(dashboard.efficiency.winRatePercent, 66.7);

  // Média de ciclo: (10 + 20) / 2 = 15 dias
  assert.equal(dashboard.efficiency.avgSalesCycleDays, 15);
});

test('Fase B8 — Painel Executivo: Deteção de Negócios Sem Próximo Passo', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Gama Enterprises'
    }
  });

  // Oportunidade 1: Aberta e SEM tarefas
  const oppSemTarefa = await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Negócio Órfão',
      companyId: comp.id,
      stage: 'QUALIFICATION',
      estimatedValue: 4000
    }
  });

  // Oportunidade 2: Aberta mas COM tarefa agendada pendente
  const oppComTarefa = await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-helderlabs',
      title: 'Negócio Ativo',
      companyId: comp.id,
      stage: 'PROPOSAL',
      estimatedValue: 6000
    }
  });

  await fakeDb.communication.create({
    data: {
      tenantId: 'tenant-helderlabs',
      opportunityId: oppComTarefa.id,
      type: 'call',
      subject: 'Follow-up de proposta',
      status: 'PENDING',
      dueDate: new Date(Date.now() + 86400000)
    }
  });

  const dashboard = await service.getExecutiveDashboard();

  assert.equal(dashboard.dealsWithoutNextStep.count, 1);
  assert.equal(dashboard.dealsWithoutNextStep.items[0].id, oppSemTarefa.id);
  assert.equal(dashboard.dealsWithoutNextStep.items[0].title, 'Negócio Órfão');
});

test('Fase B8 — Painel Executivo: Isolamento Multi-tenant e Exclusão de Soft-deleted', async () => {
  const fakeDb = createFakePrismaClient();
  const serviceA = new EnterpriseCRMService('tenant-alpha', fakeDb as any);
  const serviceB = new EnterpriseCRMService('tenant-beta', fakeDb as any);

  const compA = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-alpha',
      tradeName: 'Alfa Tech'
    }
  });

  // Oportunidade do Tenant A
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-alpha',
      title: 'Oportunidade A',
      companyId: compA.id,
      stage: 'PROPOSAL',
      estimatedValue: 10000,
      probability: 50
    }
  });

  // Oportunidade apagada (soft-deleted) do Tenant A
  await fakeDb.opportunity.create({
    data: {
      tenantId: 'tenant-alpha',
      title: 'Oportunidade Apagada',
      companyId: compA.id,
      stage: 'PROPOSAL',
      estimatedValue: 50000,
      deletedAt: new Date()
    }
  });

  const dashA = await serviceA.getExecutiveDashboard();
  const dashB = await serviceB.getExecutiveDashboard();

  // Tenant A: só conta 10.000 EUR (ignora soft-delete de 50.000 EUR)
  assert.equal(dashA.pipeline.totalOpenValueCents, 1000000);

  // Tenant B: 0 EUR (não vê dados do Tenant A)
  assert.equal(dashB.pipeline.totalOpenValueCents, 0);
});

test('Fase B8 — Exportação CSV: Sanitização Contra Formula Injection e Formatação UTF-8', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  // 1. Testar função estática de sanitização
  assert.equal(EnterpriseCRMService.sanitizeCsvCell('=1+1'), "''=1+1".slice(1)); // prefixado com '
  assert.equal(EnterpriseCRMService.sanitizeCsvCell('@SUM(A1:A10)'), "'@SUM(A1:A10)");
  assert.equal(EnterpriseCRMService.sanitizeCsvCell('+12345'), "'+12345");
  assert.equal(EnterpriseCRMService.sanitizeCsvCell('-12345'), "'-12345");
  assert.equal(EnterpriseCRMService.sanitizeCsvCell('Texto Normal'), 'Texto Normal');

  // 2. Empresa com payload potencialmente malicioso
  await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: '=cmd|"/c calc"!A1',
      legalName: 'Empresa Segura Lda',
      taxNumber: '509999888'
    }
  });

  const csv = await service.exportCompaniesCsv();

  // Começa com UTF-8 BOM
  assert.equal(csv.startsWith('\uFEFF'), true);

  // Cabeçalhos presentes
  assert.match(csv, /Nome Comercial;Firma Juridica;NIF;/);

  // A fórmula foi neutralizada com apóstrofo
  assert.match(csv, /'=cmd/);
  assert.doesNotMatch(csv, /;=cmd/);
});
