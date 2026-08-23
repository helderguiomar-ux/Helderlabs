import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantScopedArgs } from '../../src/database/prisma/tenantScopedClient';

// Testa a REESCRITA de argumentos que a Prisma Client Extension aplica a
// cada query (ver src/database/prisma/tenantScopedClient.ts). Isto é
// deliberadamente uma função pura, sem tocar no Prisma real, porque gerar o
// Prisma Client (`prisma generate`) exige rede para binaries.prisma.sh, que
// esta sandbox não tem — mas a lógica de isolamento por tenant não depende
// disso e pode (e deve) ser verificada isoladamente.
//
// Isto cobre a "forma" da reescrita; o comportamento fim-a-fim contra um
// Postgres real fica como próximo passo a correr fora da sandbox, depois de
// `npm run prisma:generate`.

describe('buildTenantScopedArgs', () => {
  test('findMany num modelo tenant-scoped: injeta where.tenantId', () => {
    const args = buildTenantScopedArgs('Lead', 'findMany', { where: { status: 'NEW' } }, 'tenant_1');
    assert.deepEqual(args.where, { status: 'NEW', tenantId: 'tenant_1' });
  });

  test('findUnique: acrescenta tenantId ao where sem remover o id', () => {
    const args = buildTenantScopedArgs('Opportunity', 'findUnique', { where: { id: 'opp_1' } }, 'tenant_1');
    assert.deepEqual(args.where, { id: 'opp_1', tenantId: 'tenant_1' });
  });

  test('create: carimba data.tenantId', () => {
    const args = buildTenantScopedArgs('Lead', 'create', { data: { company: 'Acme' } }, 'tenant_1');
    assert.deepEqual(args.data, { company: 'Acme', tenantId: 'tenant_1' });
  });

  test('create: tenantId injetado NUNCA pode ser substituído por um valor vindo dos dados do pedido', () => {
    // Mesmo que alguém (ou um bug futuro) tente passar um tenantId
    // diferente nos dados, a extensão sobrepõe-se sempre por último.
    const args = buildTenantScopedArgs('Lead', 'create', { data: { company: 'Acme', tenantId: 'tenant_atacante' } }, 'tenant_1');
    assert.equal(args.data.tenantId, 'tenant_1');
  });

  test('update/delete: injeta tenantId no where', () => {
    const updateArgs = buildTenantScopedArgs('Opportunity', 'update', { where: { id: 'opp_1' }, data: { stage: 'WON' } }, 'tenant_1');
    assert.deepEqual(updateArgs.where, { id: 'opp_1', tenantId: 'tenant_1' });

    const deleteArgs = buildTenantScopedArgs('Opportunity', 'delete', { where: { id: 'opp_1' } }, 'tenant_1');
    assert.deepEqual(deleteArgs.where, { id: 'opp_1', tenantId: 'tenant_1' });
  });

  test('upsert: injeta tenantId no where e no create', () => {
    const args = buildTenantScopedArgs(
      'Customer',
      'upsert',
      { where: { id: 'cust_1' }, create: { companyName: 'Acme' }, update: { companyName: 'Acme Lda' } },
      'tenant_1'
    );
    assert.deepEqual(args.where, { id: 'cust_1', tenantId: 'tenant_1' });
    assert.deepEqual(args.create, { companyName: 'Acme', tenantId: 'tenant_1' });
  });

  test('createMany: carimba tenantId em cada item da lista', () => {
    const args = buildTenantScopedArgs(
      'Lead',
      'createMany',
      { data: [{ company: 'A' }, { company: 'B' }] },
      'tenant_1'
    );
    assert.deepEqual(args.data, [
      { company: 'A', tenantId: 'tenant_1' },
      { company: 'B', tenantId: 'tenant_1' }
    ]);
  });

  test('modelo fora da lista tenant-scoped (ex.: Tenant): não é tocado', () => {
    const args = buildTenantScopedArgs('Tenant', 'findMany', { where: { name: 'HelderLabs' } }, 'tenant_1');
    assert.deepEqual(args.where, { name: 'HelderLabs' });
  });

  test('Building (módulo Condomínios) é tenant-scoped tal como Lead/Opportunity/Customer', () => {
    const args = buildTenantScopedArgs('Building', 'findMany', { where: { municipality: 'Lisboa' } }, 'tenant_1');
    assert.deepEqual(args.where, { municipality: 'Lisboa', tenantId: 'tenant_1' });
  });

  test('Unit (sem tenantId direto, só buildingId) NÃO é tocado pela extensão — isolamento é responsabilidade do service layer', () => {
    const args = buildTenantScopedArgs('Unit', 'findMany', { where: { buildingId: 'building_1' } }, 'tenant_1');
    assert.deepEqual(args.where, { buildingId: 'building_1' });
  });

  test('sem model definido (ex.: $queryRaw): args passam intactos', () => {
    const args = buildTenantScopedArgs(undefined, 'queryRaw', { sql: 'SELECT 1' }, 'tenant_1');
    assert.deepEqual(args, { sql: 'SELECT 1' });
  });
});
