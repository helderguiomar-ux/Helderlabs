import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseCRMService } from '../../src/modules/crm/services/EnterpriseCRMService';
import { AppError } from '../../src/utils/errors';

describe('CRM Fase B2 — Pipeline Comercial, Funil Kanban & Oportunidades', () => {

  describe('Funil Kanban e Calculo de Receita Ponderada (getPipelineKanban)', () => {
    test('getPipelineKanban: distribui estagios e calcula soma total e valor ponderado exato', async () => {
      const mockOpps = [
        {
          id: 'opp_1',
          tenantId: 'tenant_1',
          title: 'Licenciamento Enterprise',
          stage: 'QUALIFICATION',
          estimatedValue: 10000,
          probability: 20,
          deletedAt: null
        },
        {
          id: 'opp_2',
          tenantId: 'tenant_1',
          title: 'Consultoria Cloud',
          stage: 'PROPOSAL',
          estimatedValue: 20000,
          probability: 50,
          deletedAt: null
        },
        {
          id: 'opp_3',
          tenantId: 'tenant_1',
          title: 'Desenvolvimento À Medida',
          stage: 'NEGOTIATION',
          estimatedValue: 30000,
          probability: 80,
          deletedAt: null
        },
        {
          id: 'opp_4',
          tenantId: 'tenant_1',
          title: 'Suporte SLA Anual',
          stage: 'WON',
          estimatedValue: 15000,
          probability: 100,
          deletedAt: null
        },
        {
          id: 'opp_5',
          tenantId: 'tenant_1',
          title: 'Serviço Perdido',
          stage: 'LOST',
          estimatedValue: 5000,
          probability: 0,
          deletedAt: null
        }
      ];

      const fakeDb: any = {
        opportunity: {
          findMany: async ({ where }: any) => {
            assert.equal(where.tenantId, 'tenant_1');
            assert.equal(where.deletedAt, null);
            return mockOpps;
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.getPipelineKanban();

      // Verificação das colunas
      assert.equal(res.columns.QUALIFICATION.count, 1);
      assert.equal(res.columns.QUALIFICATION.totalValue, 10000);
      assert.equal(res.columns.QUALIFICATION.weightedValue, 2000); // 10000 * 20%

      assert.equal(res.columns.PROPOSAL.count, 1);
      assert.equal(res.columns.PROPOSAL.totalValue, 20000);
      assert.equal(res.columns.PROPOSAL.weightedValue, 10000); // 20000 * 50%

      assert.equal(res.columns.NEGOTIATION.count, 1);
      assert.equal(res.columns.NEGOTIATION.totalValue, 30000);
      assert.equal(res.columns.NEGOTIATION.weightedValue, 24000); // 30000 * 80%

      assert.equal(res.columns.WON.count, 1);
      assert.equal(res.columns.WON.totalValue, 15000);
      assert.equal(res.columns.WON.weightedValue, 15000);

      assert.equal(res.columns.LOST.count, 1);
      assert.equal(res.columns.LOST.totalValue, 5000);
      assert.equal(res.columns.LOST.weightedValue, 0);

      // Verificação dos totais no summary
      // Total Pipeline (sem LOST): 10000 + 20000 + 30000 + 15000 = 75000
      assert.equal(res.summary.totalPipelineValue, 75000);
      // Total Ponderado (sem LOST): 2000 + 10000 + 24000 + 15000 = 51000
      assert.equal(res.summary.totalWeightedValue, 51000);
      assert.equal(res.summary.wonValue, 15000);
      // Conversão: 1 ganho / (1 ganho + 1 perdido) = 50%
      assert.equal(res.summary.conversionRate, 50);
    });
  });

  describe('Isolamento Multi-tenant e Criacao de Oportunidades', () => {
    test('createOpportunity: rejeita companyId que pertence a outro tenant com 404', async () => {
      const fakeDb: any = {
        company: {
          findFirst: async () => null // Não pertence a tenant_1
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);

      await assert.rejects(
        () => service.createOpportunity({
          title: 'Negócio Inválido',
          estimatedValue: 5000,
          companyId: 'comp_outro_tenant'
        }),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    });

    test('createOpportunity: define probabilidade padrao com base no estagio se omitida', async () => {
      let createdData: any = null;
      const fakeDb: any = {
        opportunity: {
          create: async ({ data }: any) => {
            createdData = data;
            return { id: 'opp_nova', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const opp = await service.createOpportunity({
        title: 'Nova Proposta Comercial',
        estimatedValue: 12000,
        stage: 'PROPOSAL'
      });

      assert.equal(opp.id, 'opp_nova');
      assert.equal(createdData.probability, 50); // Default para PROPOSAL
      assert.equal(createdData.tenantId, 'tenant_1');
    });
  });

  describe('Transicoes de Estagio e Regras de Negocio (WON / LOST)', () => {
    test('updateOpportunityStage WON: define probabilidade 100%, sincroniza empresa para CUSTOMER e cria cliente', async () => {
      const existingOpp = {
        id: 'opp_100',
        tenantId: 'tenant_1',
        title: 'Projeto Estratégico',
        stage: 'NEGOTIATION',
        estimatedValue: 25000,
        probability: 80,
        companyId: 'comp_1',
        leadId: 'lead_1',
        deletedAt: null
      };

      let companyUpdated = false;
      let leadUpdated = false;
      let customerCreated = false;
      let oppUpdatedData: any = null;

      const fakeDb: any = {
        opportunity: {
          findFirst: async () => existingOpp,
          update: async ({ data }: any) => {
            oppUpdatedData = { ...oppUpdatedData, ...data };
            return { ...existingOpp, ...oppUpdatedData };
          }
        },
        company: {
          update: async ({ where, data }: any) => {
            if (where.id === 'comp_1' && data.status === 'CUSTOMER') {
              companyUpdated = true;
            }
          }
        },
        lead: {
          update: async ({ where, data }: any) => {
            if (where.id === 'lead_1' && data.status === 'CONVERTED') {
              leadUpdated = true;
            }
          }
        },
        customer: {
          create: async ({ data }: any) => {
            customerCreated = true;
            return { id: 'cust_new', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.updateOpportunityStage('opp_100', 'WON');

      assert.equal(res.stage, 'WON');
      assert.equal(oppUpdatedData.probability, 100);
      assert.equal(companyUpdated, true);
      assert.equal(leadUpdated, true);
      assert.equal(customerCreated, true);
    });

    test('updateOpportunityStage LOST: define probabilidade 0% e regista lostReason', async () => {
      const existingOpp = {
        id: 'opp_200',
        tenantId: 'tenant_1',
        title: 'Concurso Público',
        stage: 'PROPOSAL',
        estimatedValue: 40000,
        probability: 50,
        deletedAt: null
      };

      let oppUpdatedData: any = null;

      const fakeDb: any = {
        opportunity: {
          findFirst: async () => existingOpp,
          update: async ({ data }: any) => {
            oppUpdatedData = data;
            return { ...existingOpp, ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const res = await service.updateOpportunityStage('opp_200', 'LOST', {
        lostReason: 'Preço 20% acima da proposta concorrente'
      });

      assert.equal(res.stage, 'LOST');
      assert.equal(oppUpdatedData.probability, 0);
      assert.equal(oppUpdatedData.lostReason, 'Preço 20% acima da proposta concorrente');
    });

    test('assertOpportunityOwned: bloqueia oportunidade de outro tenant com 404', async () => {
      const fakeDb: any = {
        opportunity: {
          findFirst: async () => null // Pertence a outro tenant
        }
      };

      const service = new EnterpriseCRMService('tenant_A', fakeDb);

      await assert.rejects(
        () => service.updateOpportunityStage('opp_tenant_b', 'WON'),
        /Oportunidade não encontrada/
      );

      await assert.rejects(
        () => service.deleteOpportunity('opp_tenant_b'),
        /Oportunidade não encontrada/
      );
    });
  });

  describe('Conversao de Lead e Criacao de Empresa 360 (convertLeadToOpportunity)', () => {
    test('convertLeadToOpportunity: qualifica a lead e sincroniza empresa no diretorio 360', async () => {
      const leadData = {
        id: 'lead_50',
        tenantId: 'tenant_1',
        company: 'Vanguard Investimentos Lda',
        name: 'Duarte Pacheco',
        email: 'duarte@vanguard.pt',
        phone: '918888888',
        assignedUserId: 'user_sales_1'
      };

      let createdCompany: any = null;
      let createdContact: any = null;
      let createdOpp: any = null;

      const fakeDb: any = {
        lead: {
          findFirst: async () => leadData,
          update: async () => ({})
        },
        company: {
          findFirst: async () => null, // Ainda não existe
          create: async ({ data }: any) => {
            createdCompany = { id: 'comp_vanguard', ...data };
            return createdCompany;
          }
        },
        companyContact: {
          create: async ({ data }: any) => {
            createdContact = data;
            return { id: 'cont_1', ...data };
          }
        },
        opportunity: {
          create: async ({ data }: any) => {
            createdOpp = data;
            return { id: 'opp_50', ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      const opp = await service.convertLeadToOpportunity('lead_50', 50000, {
        createCompany: true,
        title: 'Mandato de Consultoria M&A'
      });

      assert.equal(opp.id, 'opp_50');
      assert.equal(createdOpp.companyId, 'comp_vanguard');
      assert.equal(createdOpp.estimatedValue, 50000);
      assert.equal(createdOpp.stage, 'QUALIFICATION');
      assert.equal(createdOpp.probability, 20);

      assert.equal(createdCompany.tradeName, 'Vanguard Investimentos Lda');
      assert.equal(createdCompany.status, 'LEAD');
      assert.equal(createdContact.name, 'Duarte Pacheco');
    });
  });

  describe('Soft Delete de Oportunidades', () => {
    test('deleteOpportunity: grava deletedAt preservando integridade referencial', async () => {
      const existingOpp = {
        id: 'opp_del',
        tenantId: 'tenant_1',
        title: 'Negócio a Arquivar',
        deletedAt: null
      };

      let deletedPayload: any = null;

      const fakeDb: any = {
        opportunity: {
          findFirst: async () => existingOpp,
          update: async ({ data }: any) => {
            deletedPayload = data;
            return { ...existingOpp, ...data };
          }
        }
      };

      const service = new EnterpriseCRMService('tenant_1', fakeDb);
      await service.deleteOpportunity('opp_del');

      assert.ok(deletedPayload.deletedAt instanceof Date);
    });
  });
});
