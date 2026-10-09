import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { createFakePrismaClient } from './support/fakePrismaClient';
import { AppError } from '../../src/utils/errors';

describe('CRM Fase B3 — Atividades Comerciais, Histórico 360º & Follow-ups', () => {

  test('createActivity: regista atividade com sucesso associada a empresa e oportunidade do tenant', async () => {
    const fakeDb = createFakePrismaClient();

    // Setup: empresa e oportunidade no tenant_1
    const company = await fakeDb.company.create({
      data: { tenantId: 'tenant_1', tradeName: 'Tech Inovações Lda' }
    });
    const opp = await fakeDb.opportunity.create({
      data: { tenantId: 'tenant_1', title: 'Consultoria TI', estimatedValue: 15000, companyId: company.id }
    });

    const service = new EnterpriseCRMService('tenant_1', fakeDb as any);

    const futureDate = new Date(Date.now() + 86400000); // amanhã
    const activity = await service.createActivity({
      type: 'call',
      subject: 'Reunião de alinhamento com CEO',
      content: 'Apresentar proposta de valor e discutir cronograma.',
      companyId: company.id,
      opportunityId: opp.id,
      priority: 'HIGH',
      dueDate: futureDate
    });

    assert.ok(activity.id);
    assert.equal(activity.tenantId, 'tenant_1');
    assert.equal(activity.type, 'call');
    assert.equal(activity.subject, 'Reunião de alinhamento com CEO');
    assert.equal(activity.priority, 'HIGH');
    assert.equal(activity.status, 'PENDING'); // auto-definido como PENDING porque tem dueDate futuro
    assert.equal(activity.companyId, company.id);
    assert.equal(activity.opportunityId, opp.id);
  });

  test('createActivity: bloqueia associação a empresa ou oportunidade de outro tenant (404)', async () => {
    const fakeDb = createFakePrismaClient();

    // Empresa criada para o tenant_2
    const foreignCompany = await fakeDb.company.create({
      data: { tenantId: 'tenant_2', tradeName: 'Empresa Alheia SA' }
    });

    const service1 = new EnterpriseCRMService('tenant_1', fakeDb as any);

    await assert.rejects(
      async () => {
        await service1.createActivity({
          type: 'task',
          subject: 'Tentativa de cross-tenant',
          companyId: foreignCompany.id
        });
      },
      (err: any) => err instanceof AppError && err.statusCode === 404 && err.message.includes('Empresa não encontrada')
    );
  });

  test('listActivities: isola dados por tenant e calcula isOverdue para follow-ups atrasados', async () => {
    const fakeDb = createFakePrismaClient();
    const service1 = new EnterpriseCRMService('tenant_1', fakeDb as any);
    const service2 = new EnterpriseCRMService('tenant_2', fakeDb as any);

    const pastDate = new Date(Date.now() - 3600000); // 1 hora atrás
    const futureDate = new Date(Date.now() + 7200000); // 2 horas no futuro

    // Atividades no tenant_1
    await service1.createActivity({
      type: 'task',
      subject: 'Follow-up urgente atrasado',
      dueDate: pastDate,
      status: 'PENDING'
    });

    await service1.createActivity({
      type: 'meeting',
      subject: 'Reunião agendada futura',
      dueDate: futureDate,
      status: 'PENDING'
    });

    // Atividade no tenant_2
    await service2.createActivity({
      type: 'note',
      subject: 'Nota privada do tenant 2'
    });

    // Leitura pelo tenant_1
    const listTenant1 = await service1.listActivities();
    assert.equal(listTenant1.length, 2);

    const overdueItem = listTenant1.find((a: any) => a.subject === 'Follow-up urgente atrasado');
    const futureItem = listTenant1.find((a: any) => a.subject === 'Reunião agendada futura');

    assert.ok(overdueItem);
    assert.equal(overdueItem.isOverdue, true);

    assert.ok(futureItem);
    assert.equal(futureItem.isOverdue, false);

    // Leitura pelo tenant_2: só vê a sua atividade
    const listTenant2 = await service2.listActivities();
    assert.equal(listTenant2.length, 1);
    assert.equal(listTenant2[0].subject, 'Nota privada do tenant 2');
  });

  test('getPendingActivitiesSummary: resume métricas de tarefas pendentes, atrasadas e hoje', async () => {
    const fakeDb = createFakePrismaClient();
    const service = new EnterpriseCRMService('tenant_1', fakeDb as any);

    const pastDate = new Date(Date.now() - 86400000); // ontem (atrasado)
    const todayDate = new Date(Date.now() + 3600000); // mais logo hoje (+1h)
    const nextWeekDate = new Date(Date.now() + 86400000 * 7); // próxima semana

    await service.createActivity({
      type: 'call',
      subject: 'Telefonar ao cliente (atrasado)',
      dueDate: pastDate,
      status: 'PENDING'
    });

    await service.createActivity({
      type: 'meeting',
      subject: 'Reunião hoje',
      dueDate: todayDate,
      status: 'PENDING'
    });

    await service.createActivity({
      type: 'task',
      subject: 'Apresentar proposta próxima semana',
      dueDate: nextWeekDate,
      status: 'PENDING'
    });

    const summary = await service.getPendingActivitiesSummary();

    assert.equal(summary.totalPending, 3);
    assert.equal(summary.overdueCount, 1);
    assert.equal(summary.dueTodayCount, 1);
    assert.equal(summary.upcomingCount, 1);
  });

  test('completeActivity: marca status como COMPLETED, define completedAt e apêndice de notas', async () => {
    const fakeDb = createFakePrismaClient();
    const service = new EnterpriseCRMService('tenant_1', fakeDb as any);

    const act = await service.createActivity({
      type: 'task',
      subject: 'Enviar catálogo 2026',
      status: 'PENDING'
    });

    const completed = await service.completeActivity(act.id, 'Catálogo enviado por email via SMTP.');

    assert.equal(completed.status, 'COMPLETED');
    assert.ok(completed.completedAt);
    assert.ok(completed.content?.includes('Catálogo enviado por email via SMTP.'));
  });

  test('updateActivity e deleteActivity (soft-delete): segurança de mutação e exclusão', async () => {
    const fakeDb = createFakePrismaClient();
    const service1 = new EnterpriseCRMService('tenant_1', fakeDb as any);
    const service2 = new EnterpriseCRMService('tenant_2', fakeDb as any);

    const act = await service1.createActivity({
      type: 'note',
      subject: 'Anotação interna preliminar'
    });

    // tenant_2 não consegue atualizar nem apagar atividade do tenant_1
    await assert.rejects(
      async () => {
        await service2.updateActivity(act.id, { subject: 'Invasão' });
      },
      (err: any) => err instanceof AppError && err.statusCode === 404
    );

    await assert.rejects(
      async () => {
        await service2.deleteActivity(act.id);
      },
      (err: any) => err instanceof AppError && err.statusCode === 404
    );

    // tenant_1 atualiza com sucesso
    const updated = await service1.updateActivity(act.id, {
      subject: 'Anotação revista e aprovada',
      priority: 'URGENT'
    });
    assert.equal(updated.subject, 'Anotação revista e aprovada');
    assert.equal(updated.priority, 'URGENT');

    // tenant_1 apaga (soft-delete)
    const delRes = await service1.deleteActivity(act.id);
    assert.equal(delRes.success, true);

    // Já não aparece na listagem
    const listAfter = await service1.listActivities();
    assert.equal(listAfter.length, 0);
  });

});
