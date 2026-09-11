import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';

describe('Bloco 2 — Módulo Financeiro: Consistência de Dados, CRUD & Edição', () => {
  let app: any;
  const tenantId = `finance_test_tenant_${Date.now()}`;
  let user: any;
  let token: string;

  before(async () => {
    app = buildApp();
    await app.ready();

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Tenant Finanças Teste',
        slug: `tenant-financas-${Date.now()}`,
        status: 'ACTIVE'
      }
    });

    user = await prisma.user.create({
      data: {
        tenantId,
        name: 'Gestor Financeiro',
        email: `gestor.financeiro.${Date.now()}@helderlabs.eu`,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE'
      }
    });

    // Registar e licenciar módulo financas e finance
    let modFinance = await prisma.module.findFirst({
      where: { key: { in: ['financas', 'finance'] } }
    });
    if (!modFinance) {
      modFinance = await prisma.module.create({
        data: { key: 'financas', name: 'FINANÇAS', isActive: true }
      });
    }

    const appInst = await prisma.applicationInstance.create({
      data: { moduleId: modFinance.id, tenantId, status: 'ACTIVE' }
    });

    await prisma.applicationAssignment.create({
      data: { userId: user.id, applicationId: appInst.id, roleInApp: 'ADMIN', status: 'ACTIVE' }
    });

    const secret = process.env.JWT_SECRET || 'jwt_secret_dev_local_only';
    token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      secret,
      { expiresIn: '1h' }
    );
  });

  after(async () => {
    await prisma.financeTransaction.deleteMany({ where: { tenantId } });
    await prisma.financeAccount.deleteMany({ where: { tenantId } });
    await prisma.financeCategory.deleteMany({ where: { tenantId } });
    await prisma.costCenter.deleteMany({ where: { tenantId } });
    await prisma.applicationAssignment.deleteMany({ where: { userId: user.id } });
    await prisma.applicationInstance.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  });

  it('1. CRUD Completo de Transações: Criação, Edição Total (PUT), Liquidação e Arquivo', async () => {
    // 1. Criar conta e categoria
    const accRes = await app.inject({
      method: 'POST',
      url: '/api/financas/accounts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Conta À Ordem Millennium',
        accountType: 'BANK',
        openingBalanceCents: 50000, // 500.00 €
        currency: 'EUR',
        isDefault: true
      }
    });
    assert.equal(accRes.statusCode, 201);
    const accBody = JSON.parse(accRes.payload);
    const accountId = accBody.account.id;

    const catRes = await app.inject({
      method: 'POST',
      url: '/api/financas/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Consultoria Informática',
        kind: 'INCOME',
        color: '#10b981'
      }
    });
    assert.equal(catRes.statusCode, 201);
    const catBody = JSON.parse(catRes.payload);
    const categoryId = catBody.category.id;

    // 2. Criar Transação Inicial de Receita Agendada
    const createTxRes = await app.inject({
      method: 'POST',
      url: '/api/financas/transactions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Desenvolvimento Software Mês 1',
        kind: 'INCOME',
        amountCents: 150000, // 1500.00 €
        dueDate: '2026-10-15',
        status: 'PLANNED',
        accountId,
        categoryId,
        counterpartyName: 'Cliente Beta Lda'
      }
    });

    assert.equal(createTxRes.statusCode, 201);
    const tx = JSON.parse(createTxRes.payload).transaction;
    assert.equal(tx.amountCents, 150000);
    assert.equal(tx.status, 'PLANNED');

    // 3. EDITAR Transação (Alterar descrição, valor para 1800.00 € e data de vencimento)
    const updateTxRes = await app.inject({
      method: 'PUT',
      url: `/api/financas/transactions/${tx.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Desenvolvimento Software Mês 1 + Módulo Extra',
        amountCents: 180000, // 1800.00 €
        dueDate: '2026-10-20',
        counterpartyName: 'Cliente Beta Grupo S.A.'
      }
    });

    assert.equal(updateTxRes.statusCode, 200, 'PUT /api/financas/transactions/:id deve permitir edição');
    const updatedTx = JSON.parse(updateTxRes.payload).transaction;
    assert.equal(updatedTx.description, 'Desenvolvimento Software Mês 1 + Módulo Extra');
    assert.equal(updatedTx.amountCents, 180000);
    assert.equal(updatedTx.counterpartyName, 'Cliente Beta Grupo S.A.');

    // 4. Liquidar transação (Marcar como PAGA)
    const payRes = await app.inject({
      method: 'PATCH',
      url: `/api/financas/transactions/${tx.id}/pay`,
      headers: { authorization: `Bearer ${token}` },
      payload: { isPaid: true }
    });

    assert.equal(payRes.statusCode, 200);
    const paidTx = JSON.parse(payRes.payload).transaction;
    assert.equal(paidTx.status, 'PAID');
    assert.ok(paidTx.paidDate);

    // 5. Arquivar / Eliminar Transação
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/financas/transactions/${tx.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(deleteRes.statusCode, 200);

    // 6. Restaurar Transação
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/financas/transactions/${tx.id}/restore`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(restoreRes.statusCode, 200);
    assert.equal(JSON.parse(restoreRes.payload).transaction.deletedAt, null);
  });

  it('2. Consistência de Saldos em Tempo Real e KPIs Financeiros', async () => {
    // 1. Criar Conta com saldo inicial de 100.00 € (10000 cêntimos)
    const accRes = await app.inject({
      method: 'POST',
      url: '/api/financas/accounts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Conta de Operações Caixa',
        accountType: 'CASH',
        openingBalanceCents: 10000,
        currency: 'EUR'
      }
    });
    const accountId = JSON.parse(accRes.payload).account.id;

    // 2. Registar Receita Paga de 50.00 € (5000 cêntimos)
    await app.inject({
      method: 'POST',
      url: '/api/financas/transactions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Venda a Pronto',
        kind: 'INCOME',
        amountCents: 5000,
        dueDate: '2026-09-11',
        status: 'PAID',
        accountId
      }
    });

    // 3. Registar Despesa Paga de 20.00 € (2000 cêntimos)
    const expenseRes = await app.inject({
      method: 'POST',
      url: '/api/financas/transactions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Material de Escritório',
        kind: 'EXPENSE',
        amountCents: 2000,
        dueDate: '2026-09-11',
        status: 'PAID',
        accountId
      }
    });
    const expenseId = JSON.parse(expenseRes.payload).transaction.id;

    // 4. Registar Despesa Agendada / Futura de 40.00 € (4000 cêntimos)
    await app.inject({
      method: 'POST',
      url: '/api/financas/transactions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Renda Futura',
        kind: 'EXPENSE',
        amountCents: 4000,
        dueDate: '2026-10-01',
        status: 'PLANNED',
        accountId
      }
    });

    // 5. Verificar Saldo Consolidado da Conta: 100€ + 50€ - 20€ = 130.00 € (13000 cêntimos)
    const accountsRes = await app.inject({
      method: 'GET',
      url: '/api/financas/accounts',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(accountsRes.statusCode, 200);
    const accounts = JSON.parse(accountsRes.payload).accounts;
    const targetAccount = accounts.find((a: any) => a.id === accountId);
    assert.ok(targetAccount);
    assert.equal(targetAccount.currentBalanceCents, 13000, 'Saldo da conta em caixa deve ser exatamente 13000 cêntimos');

    // 6. Editar Despesa de 20€ para 30€ (3000 cêntimos) -> Saldo da conta passa a 120.00 € (12000 cêntimos)
    await app.inject({
      method: 'PUT',
      url: `/api/financas/transactions/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        amountCents: 3000
      }
    });

    const accountsAfterEdit = await app.inject({
      method: 'GET',
      url: '/api/financas/accounts',
      headers: { authorization: `Bearer ${token}` }
    });
    const editedAccount = JSON.parse(accountsAfterEdit.payload).accounts.find((a: any) => a.id === accountId);
    assert.equal(editedAccount.currentBalanceCents, 12000, 'Saldo da conta deve atualizar para 12000 cêntimos após edição');

    // 7. Verificar KPIs no Dashboard
    const dashRes = await app.inject({
      method: 'GET',
      url: '/api/financas/dashboard',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(dashRes.statusCode, 200);
    const kpis = JSON.parse(dashRes.payload).kpis;

    assert.ok(kpis.currentBalanceCents > 0);
    assert.ok(kpis.totalIncomeCents >= 5000);
    assert.ok(kpis.committedCents >= 4000);
    assert.equal(kpis.availableBalanceCents, kpis.currentBalanceCents - kpis.committedCents);

    // 8. Verificar Projeções de Caixa a 90 dias
    const projRes = await app.inject({
      method: 'GET',
      url: '/api/financas/projections?days=90',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(projRes.statusCode, 200);
    const projections = JSON.parse(projRes.payload);
    assert.equal(projections.days, 90);
    assert.ok(Array.isArray(projections.dailyPoints));
    assert.ok(projections.dailyPoints.length > 0);
  });
});
