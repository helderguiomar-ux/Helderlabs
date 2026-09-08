import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';

describe('EnterpriseCRMService & Company 360º Unit Tests', () => {
  test('calculateCompleteness calculates progressive profile score accurately', () => {
    // 1. Basic lead company: minimal info
    const basicCompany = {
      tradeName: 'Startup Alfa',
      legalName: null,
      taxNumber: null,
      email: null,
      phone: null,
      address: null,
      contacts: []
    };
    const basicScore = EnterpriseCRMService.calculateCompleteness(basicCompany);
    // tradeName (+10) = 10%
    assert.strictEqual(basicScore, 10);

    // 2. Fully documented enterprise client
    const fullCompany = {
      tradeName: 'HelderLabs Tech, Lda',
      legalName: 'HelderLabs Tecnologias e Sistemas Lda',
      taxNumber: 'PT509123456',
      email: 'contato@helderlabs.eu',
      phone: '+351210000000',
      address: 'Avenida da Liberdade 100',
      city: 'Lisboa',
      postalCode: '1250-001',
      sector: 'Tecnologia da Informação',
      employeesCount: 50,
      contacts: [{ id: 'c1', name: 'Helder' }],
      ibanMasked: 'PT50 **** **** **** **** **** 1234',
      paymentMethod: 'TRANSFER',
      contracts: [{ id: 'ct1', title: 'SLA Enterprise' }]
    };
    const fullScore = EnterpriseCRMService.calculateCompleteness(fullCompany);
    assert.strictEqual(fullScore, 100);
  });

  test('listCompanies applies tenant isolation and filters deleted records', async () => {
    const fakeDb = {
      company: {
        findMany: async ({ where }: any) => {
          assert.strictEqual(where.tenantId, 'tenant_123');
          assert.strictEqual(where.deletedAt, null);
          return [
            {
              id: 'comp_1',
              tenantId: 'tenant_123',
              tradeName: 'Empresa A',
              contacts: [],
              contracts: []
            }
          ];
        }
      }
    };

    const service = new EnterpriseCRMService('tenant_123', fakeDb);
    const companies = await service.listCompanies();

    assert.strictEqual(companies.length, 1);
    assert.strictEqual(companies[0].tradeName, 'Empresa A');
  });

  test('createCompany computes initial completeness and sets defaults', async () => {
    let createdPayload: any = null;
    const fakeDb = {
      company: {
        create: async ({ data }: any) => {
          createdPayload = data;
          return { id: 'comp_new', ...data };
        }
      }
    };

    const service = new EnterpriseCRMService('tenant_123', fakeDb);
    const newCompany = await service.createCompany({
      tradeName: 'Beta Solutions',
      taxNumber: '500123999',
      email: 'geral@betasolutions.pt',
      country: 'Portugal'
    });

    assert.strictEqual(newCompany.tradeName, 'Beta Solutions');
    assert.strictEqual(createdPayload.tenantId, 'tenant_123');
    assert.strictEqual(createdPayload.status, 'LEAD');
    assert.ok(createdPayload.completenessPercent >= 35);
  });
});
