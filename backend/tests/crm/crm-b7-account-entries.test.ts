import test from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';

test('Fase B7 — Conta Corrente: Validação e Lançamento de Débito (INVOICE)', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Alfa Tech Lda',
      taxNumber: '500123456'
    }
  });

  // 1. Falha sem documento externo obrigatório
  await assert.rejects(
    async () => {
      await service.createAccountEntry(comp.id, {
        type: 'INVOICE',
        amountCents: 15000,
        externalDocumentNumber: ''
      });
    },
    (err: any) => err.statusCode === 400 && err.code === 'MISSING_EXTERNAL_DOC'
  );

  // 2. Falha com montante inválido (zero ou negativo)
  await assert.rejects(
    async () => {
      await service.createAccountEntry(comp.id, {
        type: 'INVOICE',
        amountCents: -500,
        externalDocumentNumber: 'FT 2026/001'
      });
    },
    (err: any) => err.statusCode === 400 && err.code === 'INVALID_AMOUNT'
  );

  // 3. Sucesso na criação de fatura externa
  const invoice = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 20000, // 200.00 EUR
    externalDocumentNumber: 'FT 2026/001',
    dueDate: new Date(Date.now() + 30 * 86400000)
  });

  assert.equal(invoice.type, 'INVOICE');
  assert.equal(invoice.amountCents, 20000);
  assert.equal(invoice.externalDocumentNumber, 'FT 2026/001');
  assert.equal(invoice.isReversed, false);
});

test('Fase B7 — Conta Corrente: Extrato com Débito, Pagamento e Saldo Progressivo', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Beta Soluções Lda'
    }
  });

  // Fatura de 100,00 € (10000 cêntimos)
  const inv = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 10000,
    externalDocumentNumber: 'FT 2026/101'
  });

  // Pagamento de 40,00 € (4000 cêntimos)
  const pay = await service.createAccountEntry(comp.id, {
    type: 'PAYMENT',
    amountCents: 4000,
    method: 'TRANSFER'
  });

  const statement = await service.getCustomerStatement(comp.id);

  assert.equal(statement.totalDebitCents, 10000);
  assert.equal(statement.totalCreditCents, 4000);
  assert.equal(statement.balanceCents, 6000); // 60,00 € em dívida
  assert.equal(statement.entries.length, 2);

  // Verificar salvaguarda legal estrita
  assert.match(
    statement.legalDisclaimer,
    /Registo de documentos emitidos no seu software de faturação certificado/
  );
  assert.match(
    statement.legalDisclaimer,
    /O HelderLabs CRM não emite faturas nem serve de documento fiscal/
  );
});

test('Fase B7 — Conta Corrente: Alocação Manual e Bloqueio de Sobre-alocação', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Gama Serviços'
    }
  });

  const inv = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 10000, // 100,00 €
    externalDocumentNumber: 'FT 2026/200'
  });

  const pay = await service.createAccountEntry(comp.id, {
    type: 'PAYMENT',
    amountCents: 5000 // 50,00 €
  });

  // 1. Alocação parcial válida de 40,00 € (4000 cêntimos)
  const alloc = await service.allocatePayment(comp.id, pay.id, inv.id, 4000);
  assert.equal(alloc.amountCents, 4000);

  // 2. Tentar alocar mais 20,00 € quando o pagamento só tem 10,00 € restantes (50 - 40 = 10)
  await assert.rejects(
    async () => {
      await service.allocatePayment(comp.id, pay.id, inv.id, 2000);
    },
    (err: any) => err.statusCode === 400 && err.code === 'OVER_ALLOCATION_PAYMENT'
  );

  // 3. Alocar os 10,00 € restantes
  await service.allocatePayment(comp.id, pay.id, inv.id, 1000);

  // 4. Agora o pagamento está esgotado; tentar alocar mais 1 cêntimo devolve 400
  await assert.rejects(
    async () => {
      await service.allocatePayment(comp.id, pay.id, inv.id, 100);
    },
    (err: any) => err.statusCode === 400 && err.code === 'OVER_ALLOCATION_PAYMENT'
  );
});

test('Fase B7 — Conta Corrente: Alocação Automática FIFO a Faturas em Aberto', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Delta Indústria'
    }
  });

  // Duas faturas: 1ª de 30,00 €, 2ª de 50,00 €
  const inv1 = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 3000,
    externalDocumentNumber: 'FT 2026/01',
    entryDate: new Date('2026-01-01')
  });

  const inv2 = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 5000,
    externalDocumentNumber: 'FT 2026/02',
    entryDate: new Date('2026-01-10')
  });

  // Pagamento de 60,00 € com autoAllocate: true
  // Deve liquidar 30,00 € da FT 2026/01 (100%) e 30,00 € da FT 2026/02 (restando 20,00 €)
  await service.createAccountEntry(comp.id, {
    type: 'PAYMENT',
    amountCents: 6000,
    autoAllocate: true
  });

  const statement = await service.getCustomerStatement(comp.id);
  const doc1 = statement.entries.find((e) => e.id === inv1.id);
  const doc2 = statement.entries.find((e) => e.id === inv2.id);

  assert.equal(doc1?.pendingCents, 0);
  assert.equal(doc1?.isSettled, true);

  assert.equal(doc2?.pendingCents, 2000);
  assert.equal(doc2?.isSettled, false);
});

test('Fase B7 — Conta Corrente: Estorno (REVERSAL) anula efeito e cancela alocações', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Épsilon Consultoria'
    }
  });

  const inv = await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 15000,
    externalDocumentNumber: 'FT 2026/300'
  });

  // Estornar a fatura
  const reversalResult = await service.createReversal(inv.id, 'Fatura emitida por engano no ERP de faturação');
  assert.equal(reversalResult.success, true);

  // Verificar lançamento original marcado como estornado
  const updatedInv = await service.assertAccountEntryOwned(inv.id);
  assert.equal(updatedInv.isReversed, true);

  // Tentar estornar novamente devolve 400
  await assert.rejects(
    async () => {
      await service.createReversal(inv.id, 'Tentativa duplicada');
    },
    (err: any) => err.statusCode === 400 && err.code === 'ALREADY_REVERSED'
  );

  // Tentar estornar o próprio estorno devolve 400
  await assert.rejects(
    async () => {
      await service.createReversal(reversalResult.reversalEntryId, 'Estorno de estorno');
    },
    (err: any) => err.statusCode === 400 && err.code === 'CANNOT_REVERSE_REVERSAL'
  );

  // Saldo final deve ser 0 após estorno
  const statement = await service.getCustomerStatement(comp.id);
  assert.equal(statement.balanceCents, 0);
});

test('Fase B7 — Conta Corrente: Cálculo de Saldos Vencidos e Antiguidade (Aging)', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Zeta Comércio'
    }
  });

  const now = Date.now();

  // Fatura corrente (vence daqui a 10 dias)
  await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 10000,
    externalDocumentNumber: 'FT 2026/501',
    dueDate: new Date(now + 10 * 86400000)
  });

  // Fatura vencida há 15 dias (escalão 1–30 dias)
  await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 20000,
    externalDocumentNumber: 'FT 2026/502',
    dueDate: new Date(now - 15 * 86400000)
  });

  // Fatura vencida há 45 dias (escalão 31–60 dias)
  await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 30000,
    externalDocumentNumber: 'FT 2026/503',
    dueDate: new Date(now - 45 * 86400000)
  });

  const balances = await service.getCustomerBalances(comp.id);

  assert.equal(balances.currentBalanceCents, 60000); // Total dívida: 600,00 €
  assert.equal(balances.overdueBalanceCents, 50000); // Total vencido: 500,00 €

  assert.equal(balances.aging.currentCents, 10000);
  assert.equal(balances.aging.overdue1to30Cents, 20000);
  assert.equal(balances.aging.overdue31to60Cents, 30000);
  assert.equal(balances.aging.overdue61to90Cents, 0);
  assert.equal(balances.aging.overdueOver90Cents, 0);
});

test('Fase B7 — Conta Corrente: Isolamento Multi-tenant Estrito (404 Not Found)', async () => {
  const fakeDb = createFakePrismaClient();
  const serviceA = new EnterpriseCRMService('tenant-alpha', fakeDb as any);
  const serviceB = new EnterpriseCRMService('tenant-beta', fakeDb as any);

  const compA = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-alpha',
      tradeName: 'Empresa Alpha'
    }
  });

  const entryA = await serviceA.createAccountEntry(compA.id, {
    type: 'INVOICE',
    amountCents: 5000,
    externalDocumentNumber: 'FT 2026/ALPHA'
  });

  // Tenant B tenta consultar extrato de empresa do Tenant A
  await assert.rejects(
    async () => {
      await serviceB.getCustomerStatement(compA.id);
    },
    (err: any) => err.statusCode === 404
  );

  // Tenant B tenta consultar ou estornar lançamento do Tenant A
  await assert.rejects(
    async () => {
      await serviceB.createReversal(entryA.id, 'Intrusão cruzada');
    },
    (err: any) => err.statusCode === 404
  );
});

test('Fase B7 — Conta Corrente: Extrato HTML A4 com Salvaguarda Legal e Sem Termos Fiscais', async () => {
  const fakeDb = createFakePrismaClient();
  const service = new EnterpriseCRMService('tenant-helderlabs', fakeDb as any);

  const comp = await fakeDb.company.create({
    data: {
      tenantId: 'tenant-helderlabs',
      tradeName: 'Holding Madeirense',
      taxNumber: '511222333'
    }
  });

  await service.createAccountEntry(comp.id, {
    type: 'INVOICE',
    amountCents: 45000,
    externalDocumentNumber: 'FT 2026/999'
  });

  const html = await service.renderStatementHtml(comp.id);

  // Contém salvaguarda legal e aviso informativo
  assert.match(html, /EXTRATO DE CONTA CORRENTE/);
  assert.match(html, /Extrato informativo — não é um documento fiscal/);
  assert.match(html, /O HelderLabs CRM não emite faturas nem serve de documento fiscal/);

  // NÃO contém campos tributários nem certificações fiscais
  assert.doesNotMatch(html, /ATCUD/);
  assert.doesNotMatch(html, /ATCertificado/);
  assert.doesNotMatch(html, /Hash da Fatura/);
});
