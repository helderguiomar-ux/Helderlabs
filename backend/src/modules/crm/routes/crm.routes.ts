import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CRMController, type CRMRequestContext } from '../controllers/CRMController';

const controller = new CRMController();

const convertLeadSchema = z.object({
  estimatedValue: z.number().positive()
});

const createLeadSchema = z.object({
  company: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().min(1)
});

const companySchema = z.object({
  tradeName: z.string().min(1, 'Nome Comercial é obrigatório'),
  legalName: z.string().optional().nullable(),
  taxNumber: z.string().optional().nullable(),
  entityType: z.string().optional().default('LDA'),
  status: z.enum(['POTENTIAL', 'LEAD', 'CUSTOMER', 'EX_CUSTOMER', 'SUPPLIER', 'PARTNER']).optional().default('LEAD'),
  country: z.string().optional().default('Portugal'),
  district: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  sector: z.string().optional().nullable(),
  employeesCount: z.number().int().optional().nullable(),
  annualRevenueCents: z.number().int().optional().nullable(),
  originSource: z.string().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
  creditLimitCents: z.number().int().optional().nullable(),
  paymentTermsDays: z.number().int().optional().default(30),
  paymentMethod: z.string().optional().default('TRANSFER'),
  ibanMasked: z.string().optional().nullable(),
  vatScheme: z.string().optional().default('NORMAL'),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
  riskScore: z.string().optional().default('BAIXO')
});

const contactSchema = z.object({
  name: z.string().min(1, 'Nome do contacto é obrigatório'),
  role: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  isPrimary: z.boolean().optional().default(false),
  decisionPower: z.string().optional().default('INFLUENCER'),
  notes: z.string().optional().nullable()
});

const addressSchema = z.object({
  type: z.string().optional().default('HQ'),
  street: z.string().min(1, 'Morada é obrigatória'),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().default('Portugal'),
  isDefault: z.boolean().optional().default(false)
});

const documentSchema = z.object({
  name: z.string().min(1, 'Nome do documento é obrigatório'),
  category: z.string().optional().default('OTHER'),
  fileUrl: z.string().min(1, 'URL do ficheiro é obrigatório'),
  fileType: z.string().optional().nullable(),
  size: z.number().int().optional().nullable(),
  expiresAt: z.string().optional().nullable()
});

const contractSchema = z.object({
  contractNumber: z.string().min(1, 'Número do contrato é obrigatório'),
  title: z.string().min(1, 'Título do contrato é obrigatório'),
  status: z.string().optional().default('ACTIVE'),
  monthlyValueCents: z.number().int().optional().nullable(),
  annualValueCents: z.number().int().optional().nullable(),
  totalValueCents: z.number().int().optional().nullable(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  renewalType: z.string().optional().default('MANUAL'),
  noticePeriodDays: z.number().int().optional().default(30),
  documentUrl: z.string().optional().nullable(),
  terms: z.string().optional().nullable()
});

function contextFrom(request: { user?: { tenantId: string }; db?: unknown }): CRMRequestContext {
  if (!request.user || !request.db) {
    throw new Error('Rota CRM chamada sem autenticação — falta o preHandler app.authenticate.');
  }
  return { tenantId: request.user.tenantId, db: request.db as CRMRequestContext['db'] };
}

export async function crmRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', app.authenticate);
    protectedApp.addHook('preHandler', app.requireApp('crm'));

    // =======================================================================
    // EMPRESAS 360º
    // =======================================================================
    protectedApp.get('/companies', async (request, reply) => {
      const companies = await controller.listCompanies(contextFrom(request), request.query);
      return reply.status(200).send({ success: true, companies });
    });

    protectedApp.post('/companies', async (request, reply) => {
      const data = companySchema.parse(request.body);
      const company = await controller.createCompany(contextFrom(request), data);
      return reply.status(201).send({ success: true, company });
    });

    protectedApp.get<{ Params: { id: string } }>('/companies/:id', async (request, reply) => {
      const { id } = request.params;
      const company = await controller.getCompany360(contextFrom(request), id);
      return reply.status(200).send({ success: true, company });
    });

    protectedApp.put<{ Params: { id: string } }>('/companies/:id', async (request, reply) => {
      const { id } = request.params;
      const data = companySchema.partial().parse(request.body);
      const updated = await controller.updateCompany(contextFrom(request), id, data);
      return reply.status(200).send({ success: true, company: updated });
    });

    protectedApp.delete<{ Params: { id: string } }>('/companies/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteCompany(contextFrom(request), id);
      return reply.status(200).send({ success: true, message: 'Empresa arquivada com sucesso.' });
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/restore', async (request, reply) => {
      const { id } = request.params;
      const company = await controller.restoreCompany(contextFrom(request), id);
      return reply.status(200).send({ success: true, company });
    });

    // =======================================================================
    // CONTACTOS & ENDEREÇOS
    // =======================================================================
    protectedApp.post<{ Params: { id: string } }>('/companies/:id/contacts', async (request, reply) => {
      const { id } = request.params;
      const data = contactSchema.parse(request.body);
      const contact = await controller.addCompanyContact(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, contact });
    });

    protectedApp.put<{ Params: { contactId: string } }>('/contacts/:contactId', async (request, reply) => {
      const { contactId } = request.params;
      const data = contactSchema.partial().parse(request.body);
      const updated = await controller.updateCompanyContact(contextFrom(request), contactId, data);
      return reply.status(200).send({ success: true, contact: updated });
    });

    protectedApp.delete<{ Params: { contactId: string } }>('/contacts/:contactId', async (request, reply) => {
      const { contactId } = request.params;
      await controller.deleteCompanyContact(contextFrom(request), contactId);
      return reply.status(200).send({ success: true, message: 'Contacto arquivado com sucesso.' });
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/addresses', async (request, reply) => {
      const { id } = request.params;
      const data = addressSchema.parse(request.body);
      const address = await controller.addCompanyAddress(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, address });
    });

    protectedApp.delete<{ Params: { addressId: string } }>('/addresses/:addressId', async (request, reply) => {
      const { addressId } = request.params;
      await controller.deleteCompanyAddress(contextFrom(request), addressId);
      return reply.status(200).send({ success: true, message: 'Endereço removido com sucesso.' });
    });

    // =======================================================================
    // DOCUMENTOS & CONTRATOS
    // =======================================================================
    protectedApp.post<{ Params: { id: string } }>('/companies/:id/documents', async (request, reply) => {
      const { id } = request.params;
      const data = documentSchema.parse(request.body);
      const document = await controller.addCompanyDocument(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, document });
    });

    protectedApp.delete<{ Params: { docId: string } }>('/documents/:docId', async (request, reply) => {
      const { docId } = request.params;
      await controller.deleteCompanyDocument(contextFrom(request), docId);
      return reply.status(200).send({ success: true, message: 'Documento arquivado com sucesso.' });
    });

    protectedApp.get('/contracts', async (request, reply) => {
      const { companyId } = request.query as { companyId?: string };
      const contracts = await controller.listContracts(contextFrom(request), companyId);
      return reply.status(200).send({ success: true, contracts });
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/contracts', async (request, reply) => {
      const { id } = request.params;
      const data = contractSchema.parse(request.body);
      const contract = await controller.createContract(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, contract });
    });

    protectedApp.put<{ Params: { contractId: string } }>('/contracts/:contractId', async (request, reply) => {
      const { contractId } = request.params;
      const data = contractSchema.partial().parse(request.body);
      const updated = await controller.updateContract(contextFrom(request), contractId, data);
      return reply.status(200).send({ success: true, contract: updated });
    });

    protectedApp.delete<{ Params: { contractId: string } }>('/contracts/:contractId', async (request, reply) => {
      const { contractId } = request.params;
      await controller.deleteContract(contextFrom(request), contractId);
      return reply.status(200).send({ success: true, message: 'Contrato arquivado com sucesso.' });
    });

    // =======================================================================
    // RELAÇÕES SOCIETÁRIAS
    // =======================================================================
    protectedApp.post<{ Params: { fromCompanyId: string } }>('/companies/:fromCompanyId/relations', async (request, reply) => {
      const { fromCompanyId } = request.params;
      const body = z.object({
        toCompanyId: z.string().min(1),
        relationType: z.string().min(1),
        notes: z.string().optional()
      }).parse(request.body);

      const relation = await controller.addCompanyRelation(contextFrom(request), fromCompanyId, body.toCompanyId, body.relationType, body.notes);
      return reply.status(201).send({ success: true, relation });
    });

    protectedApp.delete<{ Params: { relationId: string } }>('/relations/:relationId', async (request, reply) => {
      const { relationId } = request.params;
      await controller.deleteCompanyRelation(contextFrom(request), relationId);
      return reply.status(200).send({ success: true, message: 'Relação removida com sucesso.' });
    });

    // =======================================================================
    // LEGACY LEADS & OPPORTUNITIES PIPELINE
    // =======================================================================
    protectedApp.post('/leads', async (request, reply) => {
      const data = createLeadSchema.parse(request.body);
      const lead = await controller.createLead(contextFrom(request), data as any);
      return reply.status(201).send({ success: true, lead, message: 'Lead gravada com sucesso!' });
    });

    protectedApp.get('/leads', async (request, reply) => {
      const leads = await controller.listLeads(contextFrom(request));
      return reply.status(200).send(leads);
    });

    protectedApp.put<{ Params: { id: string } }>('/leads/:id', async (request, reply) => {
      const { id } = request.params;
      const data = createLeadSchema.partial().parse(request.body);
      const updated = await controller.updateLead(contextFrom(request), id, data);
      return reply.status(200).send(updated);
    });

    protectedApp.delete<{ Params: { id: string } }>('/leads/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteLead(contextFrom(request), id);
      return reply.status(204).send();
    });

    protectedApp.get('/opportunities', async (request, reply) => {
      const opportunities = await controller.listOpportunities(contextFrom(request));
      return reply.status(200).send(opportunities);
    });

    protectedApp.get('/customers', async (request, reply) => {
      const customers = await controller.listCustomers(contextFrom(request));
      return reply.status(200).send(customers);
    });

    protectedApp.post<{ Params: { leadId: string }; Body: unknown }>(
      '/leads/:leadId/convert',
      async (request, reply) => {
        const { leadId } = request.params;
        const { estimatedValue } = convertLeadSchema.parse(request.body);

        try {
          const opportunity = await controller.convertLead(contextFrom(request), leadId, estimatedValue);
          return reply.status(201).send(opportunity);
        } catch (error) {
          return reply.status(404).send({ message: (error as Error).message });
        }
      }
    );

    protectedApp.post<{ Params: { opportunityId: string } }>(
      '/opportunities/:opportunityId/win',
      async (request, reply) => {
        const { opportunityId } = request.params;

        try {
          const customer = await controller.winOpportunity(contextFrom(request), opportunityId);
          return reply.status(200).send(customer);
        } catch (error) {
          return reply.status(404).send({ message: (error as Error).message });
        }
      }
    );

    protectedApp.get('/dashboard', async (request, reply) => {
      const metrics = await controller.dashboardMetrics(contextFrom(request));
      return reply.status(200).send(metrics);
    });
  });
}
