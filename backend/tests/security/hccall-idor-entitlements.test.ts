import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanonicalModuleKey, isModuleRegistered } from '../../src/config/modules';
import { HccallSaleService } from '../../src/modules/hccall/services/HccallSaleService';

describe('Security & Licensing E2E Tests', () => {
  describe('Canonical Modules Registry & Aliasing', () => {
    it('should resolve canonical keys for all supported modules and aliases', () => {
      assert.equal(resolveCanonicalModuleKey('finance'), 'financas');
      assert.equal(resolveCanonicalModuleKey('financas'), 'financas');
      assert.equal(resolveCanonicalModuleKey('crm'), 'crm');
      assert.equal(resolveCanonicalModuleKey('hccall'), 'hccall');
      assert.equal(resolveCanonicalModuleKey('sellmais'), 'sellmais');
      assert.equal(resolveCanonicalModuleKey('condominios'), 'condominios');
      assert.equal(resolveCanonicalModuleKey('condo'), 'condominios');
    });

    it('should verify registered module status', () => {
      assert.equal(isModuleRegistered('crm'), true);
      assert.equal(isModuleRegistered('finance'), true);
      assert.equal(isModuleRegistered('financas'), true);
      assert.equal(isModuleRegistered('hccall'), true);
      assert.equal(isModuleRegistered('sellmais'), true);
      assert.equal(isModuleRegistered('invoicing'), false);
      assert.equal(isModuleRegistered('sales'), false);
      assert.equal(isModuleRegistered('rent_a_car'), false);
    });
  });

  describe('HCCALL IDOR Protection & Scoping', () => {
    const mockDb = {
      tenantSetting: {
        findFirst: async () => ({ value: 'OWN' })
      },
      hccallSale: {
        findUnique: async ({ where }: any) => {
          if (where.id === 'sale-1') {
            return {
              id: 'sale-1',
              tenantId: 'tenant-a',
              ownerUserId: 'user-owner',
              code: 'VND-001',
              statusId: 'status-1',
              commissionCents: 5000,
              changes: []
            };
          }
          return null;
        },
        update: async ({ where, data }: any) => ({
          id: where.id,
          ...data
        })
      },
      hccallSaleStatus: {
        findUnique: async () => ({ label: 'Registada', color: '#059669', commissionState: 'CONFIRMED' })
      },
      hccallSaleChange: {
        create: async () => ({})
      }
    };

    it('should allow owner user to read sale', async () => {
      const sale = await HccallSaleService.getSaleById(mockDb, 'tenant-a', 'user-owner', 'sale-1');
      assert.equal(sale.id, 'sale-1');
      assert.equal(sale.ownerUserId, 'user-owner');
    });

    it('should block non-owner user from reading sale in OWN scope (prevent IDOR)', async () => {
      await assert.rejects(
        async () => {
          await HccallSaleService.getSaleById(mockDb, 'tenant-a', 'user-attacker', 'sale-1');
        },
        /Não tem permissão para visualizar esta venda/
      );
    });

    it('should block non-owner user from editing sale in OWN scope', async () => {
      await assert.rejects(
        async () => {
          await HccallSaleService.updateSale(mockDb, 'tenant-a', 'user-attacker', 'sale-1', {
            notes: 'Hacked note'
          });
        },
        /Não tem permissão para editar esta venda/
      );
    });

    it('should block non-owner user from deleting sale in OWN scope', async () => {
      await assert.rejects(
        async () => {
          await HccallSaleService.deleteSale(mockDb, 'tenant-a', 'user-attacker', 'sale-1');
        },
        /Não tem permissão para eliminar esta venda/
      );
    });
  });
});
