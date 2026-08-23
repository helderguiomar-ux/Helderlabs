import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';

function buildScenario() {
  const db = createFakePrismaClient();

  db.__seed.leads.push({
    id: 'lead_1',
    tenantId: 'tenant_1',
    company: 'Acme Lda',
    name: 'Maria Silva',
    email: 'maria@acme.pt',
    phone: '910000000',
    mobile: null,
    role: 'Diretora Geral',
    website: 'https://acme.pt',
    source: 'Website',
    status: 'NEW',
    assignedUserId: 'user_1'
  });

  db.__seed.communications.push({
    id: 'comm_1',
    tenantId: 'tenant_1',
    leadId: 'lead_1',
    customerId: null,
    type: 'email',
    subject: 'Primeiro contacto'
  });

  return db as any;
}

describe('EnterpriseCRMService', () => {
  test('convertLeadToOpportunity: qualifica a Lead e cria Opportunity associada', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const opportunity = await service.convertLeadToOpportunity('lead_1', 15000);

    assert.equal(opportunity.stage, 'QUALIFICATION');
    assert.equal(opportunity.estimatedValue, 15000);
    assert.equal(opportunity.probability, 20);
    assert.equal(opportunity.tenantId, 'tenant_1');
    assert.equal(opportunity.title, 'Oportunidade Comercial - Acme Lda');

    const lead = db.__seed.leads[0];
    assert.equal(lead.status, 'QUALIFICATION');
  });

  test('convertLeadToOpportunity: rejeita Lead inexistente', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    await assert.rejects(
      () => service.convertLeadToOpportunity('lead_inexistente', 1000),
      /Lead não encontrada/
    );
  });

  test('convertLeadToOpportunity: rejeita Lead que pertence a OUTRO tenant (isolamento multi-tenant)', async () => {
    const db = buildScenario();
    // 'lead_1' pertence a tenant_1 — um service amarrado a tenant_2 nunca a
    // deve conseguir ler, mesmo sabendo o id exato.
    const service = new EnterpriseCRMService('tenant_2', db);

    await assert.rejects(
      () => service.convertLeadToOpportunity('lead_1', 1000),
      /Lead não encontrada/
    );
  });

  test('winOpportunityAndCreateCustomer: cria Customer, fecha Opportunity e migra histórico', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const opportunity = await service.convertLeadToOpportunity('lead_1', 15000);
    const customer = await service.winOpportunityAndCreateCustomer(opportunity.id);

    assert.equal(customer.companyName, 'Acme Lda');
    assert.equal(customer.website, 'https://acme.pt');

    const contact = db.__seed.contacts.find((c: any) => c.customerId === customer.id);
    assert.ok(contact, 'contacto principal deve ter sido criado');
    assert.equal(contact.name, 'Maria Silva');
    assert.equal(contact.isPrimary, true);

    const updatedOpportunity = db.__seed.opportunities.find((o: any) => o.id === opportunity.id);
    assert.equal(updatedOpportunity.stage, 'WON');
    assert.equal(updatedOpportunity.customerId, customer.id);

    const communication = db.__seed.communications.find((c: any) => c.id === 'comm_1');
    assert.equal(communication.customerId, customer.id, 'histórico da Lead deve migrar para o Customer');
  });

  test('winOpportunityAndCreateCustomer: rejeita Opportunity de OUTRO tenant', async () => {
    const db = buildScenario();
    const owner = new EnterpriseCRMService('tenant_1', db);
    const opportunity = await owner.convertLeadToOpportunity('lead_1', 15000);

    const intruder = new EnterpriseCRMService('tenant_2', db);
    await assert.rejects(
      () => intruder.winOpportunityAndCreateCustomer(opportunity.id),
      /Oportunidade não encontrada/
    );
  });

  test('getAdvancedDashboardMetrics: calcula pipeline, receita esperada e taxa de conversão', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    // Segunda Lead/Opportunity que fica perdida (LOST) — não deve contar para pipeline
    db.__seed.leads.push({
      id: 'lead_2',
      tenantId: 'tenant_1',
      company: 'Beta SA',
      name: 'João Costa',
      source: 'Referência',
      status: 'NEW',
      assignedUserId: 'user_1'
    });
    db.__seed.opportunities.push({
      id: 'opp_lost',
      tenantId: 'tenant_1',
      title: 'Oportunidade Beta',
      leadId: 'lead_2',
      stage: 'LOST',
      estimatedValue: 5000,
      probability: 0,
      assignedUserId: 'user_1'
    });

    const opportunity = await service.convertLeadToOpportunity('lead_1', 15000);
    await service.winOpportunityAndCreateCustomer(opportunity.id);

    const metrics = await service.getAdvancedDashboardMetrics();

    assert.equal(metrics.totalLeads, 2);
    assert.equal(metrics.activeCustomers, 1);
    assert.equal(metrics.pipelineValue, 15000, 'oportunidade LOST não deve contar para o pipeline');
    assert.equal(metrics.conversionRate, '50.0%');
    assert.deepEqual(metrics.leadsBySource, { Website: 1, Referência: 1 });
  });

  test('createLead: cria Lead com estado NEW, carimbada com o tenantId do service', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const lead = await service.createLead({
      company: 'Nova Empresa Lda',
      name: 'Carlos Nunes',
      email: 'carlos@novaempresa.pt',
      source: 'Indicação'
    });

    assert.equal(lead.status, 'NEW');
    assert.equal(lead.company, 'Nova Empresa Lda');
    assert.equal(lead.tenantId, 'tenant_1');
    assert.ok(db.__seed.leads.find((l: any) => l.id === lead.id));
  });

  test('listLeads/listOpportunities/listCustomers: filtram pelo tenantId do service, não por um parâmetro', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    // Lead de outro tenant não deve aparecer nas listagens
    db.__seed.leads.push({
      id: 'lead_outro_tenant',
      tenantId: 'tenant_2',
      company: 'Outra Empresa',
      name: 'Ana Reis',
      source: 'Website',
      status: 'NEW'
    });

    const opportunity = await service.convertLeadToOpportunity('lead_1', 15000);
    await service.winOpportunityAndCreateCustomer(opportunity.id);

    const leads = await service.listLeads();
    const opportunities = await service.listOpportunities();
    const customers = await service.listCustomers();

    assert.equal(leads.length, 1);
    assert.equal(leads[0].id, 'lead_1');
    assert.equal(opportunities.length, 1);
    assert.equal(customers.length, 1);
  });
});
