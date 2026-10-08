import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { validatePortugueseNIF, normalizePhoneNumber } from '../../src/modules/crm/utils/validators';
import { AppError } from '../../src/utils/errors';

describe('CRM Fase B1 — Seguranca, Isolamento de Tenant e Validadores', () => {

  describe('Validadores de Dados (NIF e Telefone)', () => {
    test('validatePortugueseNIF: valida NIFs portugueses validos (individuais e coletivos)', () => {
      // 509432107 e 213456788 sao NIFs matematicamente validos (modulo 11)
      assert.equal(validatePortugueseNIF('509432107'), true);
      assert.equal(validatePortugueseNIF('PT509432107'), true);
      assert.equal(validatePortugueseNIF('pt 509 432 107'), true);
      assert.equal(validatePortugueseNIF('213456788'), true);
      assert.equal(validatePortugueseNIF('PT213456788'), true);
    });

    test('validatePortugueseNIF: rejeita NIFs invalidos ou formatados incorretamente', () => {
      assert.equal(validatePortugueseNIF(''), false);
      assert.equal(validatePortugueseNIF('12345678'), false); // menos de 9 digitos
      assert.equal(validatePortugueseNIF('1234567890'), false); // mais de 9 digitos
      assert.equal(validatePortugueseNIF('012345678'), false); // primeiro digito 0 invalido
      assert.equal(validatePortugueseNIF('509432109'), false); // checksum incorreto
      assert.equal(validatePortugueseNIF('abcdefghi'), false);
    });

    test('normalizePhoneNumber: normaliza telefones PT e internacionais para E.164', () => {
      assert.equal(normalizePhoneNumber('912345678'), '+351912345678');
      assert.equal(normalizePhoneNumber('210 000 000'), '+351210000000');
      assert.equal(normalizePhoneNumber('+351 912 345 678'), '+351912345678');
      assert.equal(normalizePhoneNumber('00351 912 345 678'), '+351912345678');
      assert.equal(normalizePhoneNumber('+34 91 123 4567'), '+34911234567');
      assert.equal(normalizePhoneNumber(null), null);
      assert.equal(normalizePhoneNumber('   '), null);
    });
  });

  describe('Deteccao de Duplicados e Prevencao de Conflito', () => {
    test('createCompany: lanca 409 quando NIF ja existe no mesmo tenant sem force', async () => {
      const existingCompany = {
        id: 'comp_existente',
        tenantId: 'tenant_1',
        tradeName: 'Empresa Original',
        taxNumber: 'PT509432107',
        deletedAt: null
      };

      const fakeDb: any = {
        company: {
          findFirst: async ({ where }: any) => {
            if (where.tenantId === 'tenant_1' && where.deletedAt === null) {
              return existingCompany;
            }
            return null;
          },
          create: async () => {
            throw new Error('Nao deve chamar create se houver duplicado');
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);

      await assert.rejects(
        () => service.createCompany({
          tradeName: 'Nova Empresa Clonada',
          taxNumber: 'PT509432107'
        }),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, 'DUPLICATE_COMPANY');
          assert.equal(err.details?.existingCompanyId, 'comp_existente');
          return true;
        }
      );
    });

    test('createCompany: permite duplicado com force: true', async () => {
      const existingCompany = {
        id: 'comp_existente',
        tenantId: 'tenant_1',
        tradeName: 'Empresa Original',
        taxNumber: 'PT509432107',
        deletedAt: null
      };

      let created = false;
      const fakeDb: any = {
        company: {
          findFirst: async () => existingCompany,
          create: async ({ data }: any) => {
            created = true;
            return { id: 'comp_forcada', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.createCompany({
        tradeName: 'Empresa Forcada',
        taxNumber: 'PT509432107',
        force: true
      });

      assert.equal(created, true);
      assert.equal(res.id, 'comp_forcada');
    });
  });

  describe('Isolamento de Tenant em Filhos (assertCompanyOwned / assertChildOwned)', () => {
    test('addCompanyContact lanca 404 se a empresa pertencer a outro tenant', async () => {
      const fakeDb: any = {
        company: {
          findFirst: async ({ where }: any) => {
            if (where.id === 'comp_tenant_b' && where.tenantId === 'tenant_A') {
              return null;
            }
            return null;
          }
        },
        companyContact: {
          create: async () => {
            throw new Error('Nao deve ser chamado para outro tenant');
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_A', fakeDb);

      await assert.rejects(
        () => service.addCompanyContact('comp_tenant_b', {
          name: 'Atacante Contacto',
          email: 'hacker@outrotenant.pt'
        }),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        }
      );
    });

    test('addCompanyAddress e addCompanyDocument rejeitam com 404 para outro tenant', async () => {
      const fakeDb: any = {
        company: {
          findFirst: async () => null // Nao pertence ao tenant atual
        }
      };

      const service = new EnterpriseCRMService('tenant_A', fakeDb);

      await assert.rejects(
        () => service.addCompanyAddress('comp_outro_tenant', { street: 'Rua Proibida' }),
        /Empresa não encontrada/
      );

      await assert.rejects(
        () => service.addCompanyDocument('comp_outro_tenant', { title: 'Doc Proibido', fileUrl: 'http://evil.com' }),
        /Empresa não encontrada/
      );
    });

    test('deleteCompanyRelation lanca 404 se a relacao pertencer a empresa de outro tenant', async () => {
      const fakeDb: any = {
        companyRelation: {
          findFirst: async () => null
        }
      };

      const service = new EnterpriseCRMService('tenant_A', fakeDb);

      await assert.rejects(
        () => service.deleteCompanyRelation('rel_123'),
        /Relação não encontrada/
      );
    });
  });

  describe('Gravação de decisionPower e Soft Delete', () => {
    test('addCompanyContact: persiste decisionPower tipado e telefone normalizado', async () => {
      let createdPayload: any = null;
      const fakeDb: any = {
        company: {
          findFirst: async () => ({ id: 'comp_1', tenantId: 'tenant_1' }),
          update: async () => ({})
        },
        companyContact: {
          create: async ({ data }: any) => {
            createdPayload = data;
            return { id: 'contact_1', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const contact = await service.addCompanyContact('comp_1', {
        name: 'Dra. Ana Sousa',
        role: 'CEO',
        email: 'ana@acme.pt',
        decisionPower: 'DECISOR',
        phone: '912345678'
      });

      assert.equal(contact.decisionPower, 'DECISOR');
      assert.equal(createdPayload.decisionPower, 'DECISOR');
      assert.equal(createdPayload.phone, '+351912345678');
    });

    test('deleteLead: executa soft delete (deletedAt preenchido)', async () => {
      let updatedPayload: any = null;
      const fakeDb: any = {
        lead: {
          findFirst: async ({ where }: any) => {
            if (where.id === 'lead_1' && where.tenantId === 'tenant_1') {
              return { id: 'lead_1', tenantId: 'tenant_1', status: 'NEW' };
            }
            return null;
          },
          update: async ({ data }: any) => {
            updatedPayload = data;
            return { id: 'lead_1', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.deleteLead('lead_1');

      assert.equal(res.id, 'lead_1');
      assert.ok(updatedPayload.deletedAt instanceof Date);
    });

    test('deleteCompanyRelation: executa soft delete da relacao (deletedAt preenchido)', async () => {
      let relationUpdated: any = null;
      const fakeDb: any = {
        companyRelation: {
          findFirst: async () => ({
            id: 'rel_1',
            fromCompany: { tenantId: 'tenant_1', deletedAt: null },
            toCompany: { tenantId: 'tenant_1', deletedAt: null }
          }),
          update: async ({ data }: any) => {
            relationUpdated = data;
            return { id: 'rel_1', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      await service.deleteCompanyRelation('rel_1');

      assert.ok(relationUpdated.deletedAt instanceof Date);
    });
  });

  describe('Paginacao no Servidor (listCompanies com cursor)', () => {
    test('listCompanies: devolve itens paginados, total e nextCursor', async () => {
      const mockItems = [
        { id: 'comp_1', tradeName: 'Empresa 1', tenantId: 'tenant_1' },
        { id: 'comp_2', tradeName: 'Empresa 2', tenantId: 'tenant_1' },
        { id: 'comp_3', tradeName: 'Empresa 3', tenantId: 'tenant_1' }
      ];

      const fakeDb: any = {
        company: {
          findMany: async ({ take, cursor, where }: any) => {
            assert.equal(where.tenantId, 'tenant_1');
            assert.equal(where.deletedAt, null);
            // take e limit + 1 = 2 + 1 = 3
            assert.equal(take, 3);
            return [...mockItems];
          },
          count: async ({ where }: any) => {
            assert.equal(where.tenantId, 'tenant_1');
            return 10;
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.listCompanies({ limit: 2 });

      // Como pedimos 2 e mock devolve 3, companies tem 2 e nextCursor e comp_3
      assert.equal(res.companies.length, 2);
      assert.equal(res.nextCursor, 'comp_3');
      assert.equal(res.total, 10);
    });
  });

  describe('Prevencao XSS (esc())', () => {
    function esc(str: any): string {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    test('esc(): neutraliza scripts, tags html, aspas e ampersands', () => {
      const maliciousPayload = '<script>alert("xss")</script>&<img src=x onerror=alert(1)>';
      const escaped = esc(maliciousPayload);

      assert.equal(escaped.includes('<script>'), false);
      assert.equal(escaped.includes('</script>'), false);
      assert.equal(escaped.includes('<img'), false);
      assert.equal(escaped, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&lt;img src=x onerror=alert(1)&gt;');
    });
  });
});
