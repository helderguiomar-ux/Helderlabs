import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';

function buildScenario() {
  const db = createFakePrismaClient();

  // Tenant 1
  db.__seed.companies.push({
    id: 'comp_1',
    tenantId: 'tenant_1',
    tradeName: 'Inovação Digital Lda',
    legalName: 'Inovação Digital Lda',
    taxNumber: '500123456',
    email: 'info@inovacao.pt'
  });

  db.__seed.proposals.push({
    id: 'prop_1',
    tenantId: 'tenant_1',
    proposalNumber: 'PROP-2026-0001',
    title: 'Proposta de Manutenção ERP',
    companyId: 'comp_1',
    status: 'ACCEPTED',
    totalCents: 120000
  });

  // Tenant 2
  db.__seed.companies.push({
    id: 'comp_tenant2',
    tenantId: 'tenant_2',
    tradeName: 'Outro Cliente Lda',
    legalName: 'Outro Cliente Lda'
  });

  return db as any;
}

describe('EnterpriseCRMService — Fase B5: Gestão de Contratos de Avença, SLA e Renovações Automáticas', () => {
  test('calculateMonthlyValue: calcula MRR equivalente com base na periocidade de faturação', () => {
    // Mensal: 1000€ -> 1000€
    assert.equal(EnterpriseCRMService.calculateMonthlyValue(100000, 'MONTHLY'), 100000);
    // Trimestral: 3000€ / 3 -> 1000€
    assert.equal(EnterpriseCRMService.calculateMonthlyValue(300000, 'QUARTERLY'), 100000);
    // Semestral: 6000€ / 6 -> 1000€
    assert.equal(EnterpriseCRMService.calculateMonthlyValue(600000, 'SEMIANNUAL'), 100000);
    // Anual: 12000€ / 12 -> 1000€
    assert.equal(EnterpriseCRMService.calculateMonthlyValue(1200000, 'ANNUAL'), 100000);
    // Pontual: 0€ MRR
    assert.equal(EnterpriseCRMService.calculateMonthlyValue(500000, 'ONE_OFF'), 0);
  });

  test('createContract: cria contrato de avença com numeração sequencial, SLA e cálculo de MRR', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-12-31');

    const contract = await service.createContract({
      companyId: 'comp_1',
      proposalId: 'prop_1',
      title: 'Contrato de Avença Suporte & SLA Cloud',
      billingFrequency: 'MONTHLY',
      valueCents: 50000, // 500.00€ / mês
      startDate,
      endDate,
      autoRenew: true,
      renewalNoticeDays: 30,
      slaLevel: 'GOLD',
      slaResponseHours: 4,
      slaResolutionHours: 24,
      termsAndConditions: 'Disponibilidade 99.9%, resposta em 4h em dias úteis.'
    });

    assert.ok(contract.id);
    assert.match(contract.contractNumber, /^CTR-\d{4}-\d{4}$/);
    assert.equal(contract.status, 'ACTIVE');
    assert.equal(contract.monthlyValueCents, 50000);
    assert.equal(contract.valueCents, 50000);
    assert.equal(contract.autoRenew, true);
    assert.equal(contract.slaLevel, 'GOLD');
    assert.equal(contract.slaResponseHours, 4);
    assert.equal(contract.slaResolutionHours, 24);
    assert.equal(contract.companyId, 'comp_1');
    assert.equal(contract.proposalId, 'prop_1');
  });

  test('listContracts: calcula KPIs de MRR, ARR e contratos a expirar', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const now = new Date();
    const in15Days = new Date();
    in15Days.setDate(now.getDate() + 15);

    const in6Months = new Date();
    in6Months.setMonth(now.getMonth() + 6);

    // Contrato 1: Ativo, expira em 15 dias (MRR 300€)
    await service.createContract({
      companyId: 'comp_1',
      title: 'Avença Prestes a Expirar',
      billingFrequency: 'MONTHLY',
      valueCents: 30000,
      startDate: now,
      endDate: in15Days,
      autoRenew: true
    });

    // Contrato 2: Ativo, anual de 12.000€ (MRR 1000€)
    await service.createContract({
      companyId: 'comp_1',
      title: 'Avença Anual Suporte',
      billingFrequency: 'ANNUAL',
      valueCents: 1200000,
      startDate: now,
      endDate: in6Months,
      autoRenew: false
    });

    const result = await service.listContracts();

    assert.equal(result.kpis.activeCount, 2);
    // MRR: 300€ + 1000€ = 1300€ = 130000 cents
    assert.equal(result.kpis.mrrCents, 130000);
    // ARR: 1300€ * 12 = 15600€ = 1560000 cents
    assert.equal(result.kpis.arrCents, 1560000);
    // 1 contrato expira nos próximos 30 dias
    assert.equal(result.kpis.expiringIn30Days, 1);
  });

  test('Isolamento Multi-tenant: bloqueia acesso e criação de contratos para outro tenant', async () => {
    const db = buildScenario();
    const service1 = new EnterpriseCRMService('tenant_1', db);
    const service2 = new EnterpriseCRMService('tenant_2', db);

    const c1 = await service1.createContract({
      companyId: 'comp_1',
      title: 'Contrato Tenant 1',
      valueCents: 20000,
      startDate: new Date()
    });

    // Tenant 2 tenta aceder -> 404
    await assert.rejects(
      () => service2.getContractById(c1.id),
      /não encontrado/
    );

    // Tenant 1 tenta associar contrato a empresa do Tenant 2 -> 404
    await assert.rejects(
      () => service1.createContract({
        companyId: 'comp_tenant2',
        title: 'Ilegítimo',
        startDate: new Date()
      }),
      /não encontrada/
    );
  });

  test('renewContract: estende vigência, aplica ajuste percentual e regista auditoria', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const initialEnd = new Date('2026-12-31');
    const contract = await service.createContract({
      companyId: 'comp_1',
      title: 'Avença Base Suporte',
      billingFrequency: 'MONTHLY',
      valueCents: 100000, // 1000€
      startDate: new Date('2026-01-01'),
      endDate: initialEnd
    });

    // Renovar com extensão de 12 meses e aumento de 5% de inflação
    const renewed = await service.renewContract(contract.id, {
      extensionMonths: 12,
      adjustmentPercent: 5,
      notes: 'Atualização anual de acordo com IPC.'
    });

    assert.equal(renewed.status, 'ACTIVE');
    assert.ok(renewed.lastRenewedAt);
    assert.equal(renewed.valueCents, 105000); // 1050.00€
    assert.equal(renewed.monthlyValueCents, 105000);
    assert.ok(new Date(renewed.endDate).getFullYear() >= 2027);
  });

  test('terminateContract: cancela contrato e grava motivo', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const contract = await service.createContract({
      companyId: 'comp_1',
      title: 'Avença a Cancelar',
      valueCents: 50000,
      startDate: new Date()
    });

    const cancelled = await service.terminateContract(contract.id, {
      reason: 'Cliente encerrou atividade comercial.'
    });

    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.cancellationReason, 'Cliente encerrou atividade comercial.');
    assert.ok(cancelled.cancelledAt);
  });

  test('deleteContract: soft-delete impede consulta subsequente', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const contract = await service.createContract({
      companyId: 'comp_1',
      title: 'Avença para Eliminar',
      valueCents: 10000,
      startDate: new Date()
    });

    await service.deleteContract(contract.id);

    await assert.rejects(
      () => service.getContractById(contract.id),
      /não encontrado/
    );
  });

  test('Salvaguarda Legal Inviolável: resumo do contrato inclui aviso explícito de não servir de fatura fiscal', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const contract = await service.createContract({
      companyId: 'comp_1',
      title: 'Resumo Legal Teste',
      valueCents: 40000,
      startDate: new Date()
    });

    const summaryHtml = await service.renderContractSummaryHtml(contract.id);

    assert.ok(
      summaryHtml.includes('Não serve de fatura nem de documento de quitação fiscal'),
      'HTML de resumo do contrato deve conter o aviso legal'
    );
  });
});
