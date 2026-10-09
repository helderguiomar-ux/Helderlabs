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
    tradeName: 'Tech Solutions Lda',
    legalName: 'Tech Solutions Lda',
    taxNumber: '500123456',
    email: 'contacto@techsolutions.pt'
  });

  db.__seed.contacts.push({
    id: 'cont_1',
    tenantId: 'tenant_1',
    companyId: 'comp_1',
    name: 'Ana Rodrigues',
    email: 'ana@techsolutions.pt'
  });

  db.__seed.opportunities.push({
    id: 'opp_1',
    tenantId: 'tenant_1',
    companyId: 'comp_1',
    title: 'Migração Cloud & ERP',
    stage: 'PROPOSAL',
    estimatedValue: 5000,
    probability: 60
  });

  // Tenant 2 (para testes de isolamento)
  db.__seed.companies.push({
    id: 'comp_tenant2',
    tenantId: 'tenant_2',
    tradeName: 'Outra Empresa Lda',
    legalName: 'Outra Empresa Lda'
  });

  return db as any;
}

describe('EnterpriseCRMService — Fase B4: Propostas e Orçamentos Comerciais', () => {
  test('calculateProposalTotals: calcula subtotais, descontos, IVA e total com precisão de cêntimos', () => {
    const items = [
      {
        description: 'Licença Software ERP Anual',
        quantity: 2,
        unitPriceCents: 100000, // 1000.00€
        discountPercent: 10 // 10% desc -> 900.00€ * 2 = 1800.00€
      },
      {
        description: 'Serviço de Consultoria / Setup',
        quantity: 5,
        unitPriceCents: 8000, // 80.00€
        discountPercent: 0 // 400.00€
      }
    ];

    const result = EnterpriseCRMService.calculateProposalTotals(items, 23.0);

    // Subtotal: 1800.00€ + 400.00€ = 2200.00€ = 220000 cents
    assert.equal(result.subtotalCents, 220000);
    // IVA 23%: 2200.00 * 0.23 = 506.00€ = 50600 cents
    assert.equal(result.vatCents, 50600);
    // Total: 2200.00 + 506.00 = 2706.00€ = 270600 cents
    assert.equal(result.totalCents, 270600);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].totalCents, 180000);
    assert.equal(result.items[1].totalCents, 40000);
  });

  test('createProposal: cria proposta comercial com numeração sequencial e itens', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const proposal = await service.createProposal({
      title: 'Proposta de Consultoria e Software ERP',
      companyId: 'comp_1',
      contactId: 'cont_1',
      opportunityId: 'opp_1',
      vatRatePercent: 23,
      notes: 'Prazo de entrega de 30 dias após adjudicação.',
      items: [
        {
          description: 'Módulo CRM e Gestão Comercial',
          quantity: 1,
          unitPriceCents: 250000 // 2500.00€
        }
      ]
    });

    assert.ok(proposal.id);
    assert.match(proposal.proposalNumber, /^PROP-\d{4}-\d{4}$/);
    assert.equal(proposal.status, 'DRAFT');
    assert.equal(proposal.subtotalCents, 250000);
    assert.equal(proposal.vatCents, 57500); // 2500 * 0.23 = 575€
    assert.equal(proposal.totalCents, 307500); // 3075€
    assert.equal(proposal.companyId, 'comp_1');
    assert.equal(proposal.contactId, 'cont_1');
    assert.equal(proposal.opportunityId, 'opp_1');
    assert.equal(proposal.items.length, 1);
  });

  test('Isolamento Multi-tenant: rejeita acesso e associação a recursos de outro tenant', async () => {
    const db = buildScenario();
    const serviceTenant1 = new EnterpriseCRMService('tenant_1', db);
    const serviceTenant2 = new EnterpriseCRMService('tenant_2', db);

    // Tenant 1 cria proposta
    const p1 = await serviceTenant1.createProposal({
      title: 'Proposta Confidencial Tenant 1',
      companyId: 'comp_1',
      items: [{ description: 'Item A', unitPriceCents: 5000 }]
    });

    // Tenant 2 tenta aceder à proposta de Tenant 1 -> 404
    await assert.rejects(
      () => serviceTenant2.getProposalById(p1.id),
      /não encontrada/
    );

    // Tenant 1 tenta associar a sua proposta a uma empresa do Tenant 2 -> 404
    await assert.rejects(
      () => serviceTenant1.createProposal({
        title: 'Proposta Ilegítima',
        companyId: 'comp_tenant2',
        items: [{ description: 'Item Inválido', unitPriceCents: 1000 }]
      }),
      /não encontrada/
    );
  });

  test('updateProposalStatus ACCEPTED: converte oportunidade associada em WON', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const proposal = await service.createProposal({
      title: 'Proposta Chave na Mão',
      companyId: 'comp_1',
      opportunityId: 'opp_1',
      items: [{ description: 'Software', unitPriceCents: 500000 }]
    });

    assert.equal(proposal.status, 'DRAFT');

    const updated = await service.updateProposalStatus(proposal.id, 'ACCEPTED', 'Adjudicado pelo cliente via reunião');

    assert.equal(updated.status, 'ACCEPTED');
    assert.ok(updated.acceptedAt);

    // Verifica se a oportunidade foi automaticamente marcada como WON
    const opp = await service.getOpportunityById('opp_1');
    assert.equal(opp.stage, 'WON');
  });

  test('deleteProposal: soft-delete impede consulta subsequente', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const proposal = await service.createProposal({
      title: 'Proposta a cancelar',
      companyId: 'comp_1',
      items: [{ description: 'Item 1', unitPriceCents: 1000 }]
    });

    await service.deleteProposal(proposal.id);

    await assert.rejects(
      () => service.getProposalById(proposal.id),
      /não encontrada/
    );
  });

  test('Salvaguarda Legal Inviolável: HTML da proposta inclui aviso explícito de não servir de fatura fiscal', async () => {
    const db = buildScenario();
    const service = new EnterpriseCRMService('tenant_1', db);

    const proposal = await service.createProposal({
      title: 'Orçamento Equipamentos',
      companyId: 'comp_1',
      items: [{ description: 'Servidor', unitPriceCents: 200000 }]
    });

    const printHtml = await service.renderProposalHtml(proposal.id);
    const emailHtml = await service.generateProposalEmailHtml(proposal);

    const legalDisclaimer = 'Não serve de fatura nem de documento de quitação fiscal';

    assert.ok(printHtml.includes(legalDisclaimer), 'HTML de impressão deve conter o aviso legal');
    assert.ok(emailHtml.includes(legalDisclaimer), 'HTML de email deve conter o aviso legal');
  });
});
