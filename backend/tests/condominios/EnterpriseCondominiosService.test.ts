import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BuildingNotFoundError, EnterpriseCondominiosService } from '../../src/modules/condominios/services/EnterpriseCondominiosService';
import { createFakeCondominiosPrismaClient } from './support/fakeCondominiosPrismaClient';

describe('EnterpriseCondominiosService', () => {
  test('createBuilding: carimba o tenantId do service, aplica default de totalPermille', async () => {
    const db = createFakeCondominiosPrismaClient();
    const service = new EnterpriseCondominiosService('tenant_1', db as any);

    const building = await service.createBuilding({
      name: 'Edifício Central',
      address: 'Rua Principal 10',
      municipality: 'Lisboa'
    });

    assert.equal(building.tenantId, 'tenant_1');
    assert.equal(building.totalPermille, 1000);
    assert.equal(building.taxNumber, null);
  });

  test('listBuildings: só devolve os do tenant do service', async () => {
    const db = createFakeCondominiosPrismaClient();
    db.__seed.buildings.push(
      { id: 'b1', tenantId: 'tenant_1', name: 'Edifício A', address: 'X', municipality: 'Lisboa', totalPermille: 1000 },
      { id: 'b2', tenantId: 'tenant_2', name: 'Edifício de outro tenant', address: 'Y', municipality: 'Porto', totalPermille: 1000 }
    );
    const service = new EnterpriseCondominiosService('tenant_1', db as any);

    const buildings = await service.listBuildings();

    assert.equal(buildings.length, 1);
    assert.equal(buildings[0].id, 'b1');
  });

  test('createUnit/listUnits: funcionam quando o Building pertence ao tenant do service', async () => {
    const db = createFakeCondominiosPrismaClient();
    const service = new EnterpriseCondominiosService('tenant_1', db as any);

    const building = await service.createBuilding({ name: 'Edifício A', address: 'X', municipality: 'Lisboa' });
    const unit = await service.createUnit(building.id, { identifier: 'Bloco 1, 2 Esq', permille: 120 });

    assert.equal(unit.buildingId, building.id);
    assert.equal(unit.permille, 120);

    const units = await service.listUnits(building.id);
    assert.equal(units.length, 1);
    assert.equal(units[0].id, unit.id);
  });

  test('createUnit: rejeita um Building que pertence a OUTRO tenant (isolamento transitivo)', async () => {
    const db = createFakeCondominiosPrismaClient();
    const owner = new EnterpriseCondominiosService('tenant_1', db as any);
    const building = await owner.createBuilding({ name: 'Edifício A', address: 'X', municipality: 'Lisboa' });

    const intruder = new EnterpriseCondominiosService('tenant_2', db as any);

    await assert.rejects(
      () => intruder.createUnit(building.id, { identifier: 'Bloco 1, 1 Dto', permille: 100 }),
      BuildingNotFoundError
    );
  });

  test('listUnits: rejeita um Building que pertence a OUTRO tenant (isolamento transitivo)', async () => {
    const db = createFakeCondominiosPrismaClient();
    const owner = new EnterpriseCondominiosService('tenant_1', db as any);
    const building = await owner.createBuilding({ name: 'Edifício A', address: 'X', municipality: 'Lisboa' });
    await owner.createUnit(building.id, { identifier: 'Bloco 1, 2 Esq', permille: 120 });

    const intruder = new EnterpriseCondominiosService('tenant_2', db as any);

    await assert.rejects(() => intruder.listUnits(building.id), BuildingNotFoundError);
  });

  test('createUnit/listUnits: rejeita um buildingId inexistente', async () => {
    const db = createFakeCondominiosPrismaClient();
    const service = new EnterpriseCondominiosService('tenant_1', db as any);

    await assert.rejects(() => service.createUnit('building_inexistente', { identifier: 'X', permille: 10 }), BuildingNotFoundError);
    await assert.rejects(() => service.listUnits('building_inexistente'), BuildingNotFoundError);
  });
});
