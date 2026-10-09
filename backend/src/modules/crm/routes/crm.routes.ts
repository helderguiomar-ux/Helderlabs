import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CRMController, type CRMRequestContext } from '../controllers/CRMController';
import { validatePortugueseNIF } from '../utils/validators';

const controller = new CRMController();

const opportunityStageEnum = z.enum(['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);

const convertLeadSchema = z
  .object({
    estimatedValue: z.number().positive('O valor estimado tem de ser positivo.'),
    createCompany: z.boolean().optional().default(true),
    title: z.string().trim().optional()
  })
  .strict();

const createOpportunitySchema = z
  .object({
    title: z.string().trim().min(1, 'Título é obrigatório.'),
    estimatedValue: z.number().positive('O valor estimado tem de ser positivo.'),
    stage: opportunityStageEnum.optional().default('QUALIFICATION'),
    probability: z.number().min(0).max(100).optional(),
    companyId: z.string().optional().nullable(),
    contactId: z.string().optional().nullable(),
    leadId: z.string().optional().nullable(),
    customerId: z.string().optional().nullable(),
    expectedCloseDate: z.string().optional().nullable(),
    lostReason: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    assignedUserId: z.string().optional().nullable()
  })
  .strict();

const updateOpportunityStageSchema = z
  .object({
    stage: opportunityStageEnum,
    probability: z.number().min(0).max(100).optional(),
    lostReason: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
  })
  .strict();

const updateOpportunitySchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    estimatedValue: z.number().positive().optional(),
    stage: opportunityStageEnum.optional(),
    probability: z.number().min(0).max(100).optional(),
    companyId: z.string().optional().nullable(),
    contactId: z.string().optional().nullable(),
    leadId: z.string().optional().nullable(),
    customerId: z.string().optional().nullable(),
    expectedCloseDate: z.string().optional().nullable(),
    lostReason: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    assignedUserId: z.string().optional().nullable()
  })
  .strict();

const createLeadSchema = z
  .object({
    company: z.string().trim().min(1, 'Empresa é obrigatória.'),
    name: z.string().trim().min(1, 'Nome é obrigatório.'),
    email: z.string().trim().toLowerCase().email('Email inválido.').optional().nullable().or(z.literal('')),
    phone: z.string().trim().optional().nullable(),
    source: z.string().trim().min(1, 'Origem é obrigatória.')
  })
  .strict();

const activityTypeEnum = z.enum(['task', 'call', 'meeting', 'email', 'note', 'whatsapp']);
const activityStatusEnum = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);
const activityPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createActivitySchema = z
  .object({
    type: activityTypeEnum.optional().default('task'),
    subject: z.string().trim().min(1, 'Assunto é obrigatório.'),
    content: z.string().optional().nullable(),
    status: activityStatusEnum.optional(),
    dueDate: z.string().optional().nullable(),
    priority: activityPriorityEnum.optional().default('NORMAL'),
    occurredAt: z.string().optional().nullable(),
    companyId: z.string().optional().nullable(),
    contactId: z.string().optional().nullable(),
    opportunityId: z.string().optional().nullable(),
    leadId: z.string().optional().nullable()
  })
  .strict();

const updateActivitySchema = z
  .object({
    type: activityTypeEnum.optional(),
    subject: z.string().trim().min(1).optional(),
    content: z.string().optional().nullable(),
    status: activityStatusEnum.optional(),
    dueDate: z.string().optional().nullable(),
    priority: activityPriorityEnum.optional()
  })
  .strict();

const completeActivitySchema = z
  .object({
    notes: z.string().trim().optional().nullable()
  })
  .strict();

const companyBaseShape = {
  tradeName: z.string().trim().min(1, 'Nome Comercial é obrigatório'),
  legalName: z.string().trim().optional().nullable(),
  taxNumber: z.string().trim().optional().nullable(),
  entityType: z.string().optional().default('LDA'),
  status: z.enum(['POTENTIAL', 'LEAD', 'CUSTOMER', 'EX_CUSTOMER', 'SUPPLIER', 'PARTNER']).optional().default('LEAD'),
  country: z.string().optional().default('Portugal'),
  district: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  email: z.string().trim().toLowerCase().email('Email inválido.').optional().nullable().or(z.literal('')),
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
  riskScore: z.string().optional().default('BAIXO'),
  force: z.boolean().optional().default(false)
};

const companySchema = z
  .object(companyBaseShape)
  .strict()
  .superRefine((data, ctx) => {
    if (data.taxNumber && (!data.country || data.country.toLowerCase() === 'portugal')) {
      if (!validatePortugueseNIF(data.taxNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'O NIF português indicado é inválido (dígito de controlo incorreto).',
          path: ['taxNumber']
        });
      }
    }
  });

const companyUpdateSchema = z
  .object({
    ...companyBaseShape,
    tradeName: z.string().trim().min(1, 'Nome Comercial é obrigatório').optional()
  })
  .partial()
  .strict()
  .superRefine((data, ctx) => {
    if (data.taxNumber && (!data.country || data.country.toLowerCase() === 'portugal')) {
      if (!validatePortugueseNIF(data.taxNumber)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'O NIF português indicado é inválido (dígito de controlo incorreto).',
          path: ['taxNumber']
        });
      }
    }
  });

const contactSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome do contacto é obrigatório'),
    role: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    email: z.string().trim().toLowerCase().email('Email inválido.').optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    isPrimary: z.boolean().optional().default(false),
    decisionPower: z.enum(['DECISOR', 'INFLUENCIADOR', 'UTILIZADOR', 'OUTRO']).optional().nullable(),
    notes: z.string().optional().nullable()
  })
  .strict();

const addressSchema = z
  .object({
    type: z.string().optional().default('HQ'),
    purpose: z.string().optional(),
    street: z.string().trim().min(1, 'Morada é obrigatória'),
    address: z.string().optional(),
    city: z.string().optional().nullable(),
    district: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().optional().default('Portugal'),
    isDefault: z.boolean().optional().default(false)
  })
  .strict();

const documentSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome do documento é obrigatório'),
    category: z.string().optional().default('OTHER'),
    docType: z.string().optional(),
    fileUrl: z.string().min(1, 'URL do ficheiro é obrigatório'),
    fileType: z.string().optional().nullable(),
    size: z.number().int().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
    expiryDate: z.string().optional().nullable()
  })
  .strict();

const contractSchema = z
  .object({
    contractNumber: z.string().trim().min(1, 'Número do contrato é obrigatório'),
    title: z.string().trim().min(1, 'Título do contrato é obrigatório'),
    type: z.string().optional().default('SERVICE'),
    status: z.string().optional().default('ACTIVE'),
    valueCents: z.number().int().optional(),
    monthlyValueCents: z.number().int().optional().nullable(),
    annualValueCents: z.number().int().optional().nullable(),
    totalValueCents: z.number().int().optional().nullable(),
    billingFrequency: z.string().optional(),
    autoRenew: z.boolean().optional(),
    startDate: z.string().min(1, 'Data de início é obrigatória'),
    endDate: z.string().optional().nullable(),
    renewalType: z.string().optional().default('MANUAL'),
    noticePeriodDays: z.number().int().optional().default(30),
    documentUrl: z.string().optional().nullable(),
    terms: z.string().optional().nullable()
  })
  .strict();

const listCompaniesQuerySchema = z
  .object({
    status: z.string().optional(),
    sector: z.string().optional(),
    search: z.string().optional(),
    ownerUserId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
    includeDeleted: z.coerce.boolean().optional()
  })
  .strict();

function contextFrom(request: { user?: { tenantId: string; sub?: string; id?: string }; db?: unknown }): CRMRequestContext {
  if (!request.user || !request.db) {
    throw new Error('Rota CRM chamada sem autenticação — falta o preHandler app.authenticate.');
  }
  return {
    tenantId: request.user.tenantId,
    userId: request.user.sub || request.user.id,
    db: request.db as CRMRequestContext['db']
  };
}

export async function crmRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', app.authenticate);
    protectedApp.addHook('preHandler', app.requireApp('crm'));

    // =======================================================================
    // EMPRESAS 360º & MÉTRICAS
    // =======================================================================
    protectedApp.get('/companies', async (request, reply) => {
      const query = listCompaniesQuerySchema.parse(request.query);
      const result = await controller.listCompanies(contextFrom(request), query);
      return reply.status(200).send({ success: true, ...result });
    });

    protectedApp.get('/companies/metrics', async (request, reply) => {
      const metrics = await controller.getCompaniesMetrics(contextFrom(request));
      return reply.status(200).send({ success: true, metrics });
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
      const data = companyUpdateSchema.parse(request.body);
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
      const data = contactSchema.partial().strict().parse(request.body);
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
      const data = contractSchema.partial().strict().parse(request.body);
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
      const body = z
        .object({
          toCompanyId: z.string().trim().min(1, 'Empresa de destino é obrigatória.'),
          relationType: z.string().trim().min(1, 'Tipo de relação é obrigatório.'),
          notes: z.string().optional()
        })
        .strict()
        .parse(request.body);

      const relation = await controller.addCompanyRelation(
        contextFrom(request),
        fromCompanyId,
        body.toCompanyId,
        body.relationType,
        body.notes
      );
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
      const data = createLeadSchema.partial().strict().parse(request.body);
      const updated = await controller.updateLead(contextFrom(request), id, data);
      return reply.status(200).send(updated);
    });

    protectedApp.delete<{ Params: { id: string } }>('/leads/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteLead(contextFrom(request), id);
      return reply.status(204).send();
    });

    // =========================================================================
    // PIPELINE COMERCIAL & FUNIL KANBAN (FASE B2)
    // =========================================================================

    protectedApp.get('/pipeline', async (request, reply) => {
      const { assignedUserId } = request.query as any;
      const kanban = await controller.getPipelineKanban(contextFrom(request), { assignedUserId });
      return reply.status(200).send(kanban);
    });

    protectedApp.get('/opportunities', async (request, reply) => {
      const opportunities = await controller.listOpportunities(contextFrom(request));
      return reply.status(200).send(opportunities);
    });

    protectedApp.post('/opportunities', async (request, reply) => {
      const data = createOpportunitySchema.parse(request.body);
      const opportunity = await controller.createOpportunity(contextFrom(request), data);
      return reply.status(201).send({ success: true, opportunity, message: 'Oportunidade registada com sucesso!' });
    });

    protectedApp.patch<{ Params: { id: string } }>('/opportunities/:id/stage', async (request, reply) => {
      const { id } = request.params;
      const data = updateOpportunityStageSchema.parse(request.body);
      const opportunity = await controller.updateOpportunityStage(contextFrom(request), id, data);
      return reply.status(200).send({ success: true, opportunity, message: 'Estágio atualizado com sucesso!' });
    });

    protectedApp.put<{ Params: { id: string } }>('/opportunities/:id', async (request, reply) => {
      const { id } = request.params;
      const data = updateOpportunitySchema.parse(request.body);
      const opportunity = await controller.updateOpportunity(contextFrom(request), id, data);
      return reply.status(200).send({ success: true, opportunity, message: 'Oportunidade atualizada!' });
    });

    protectedApp.delete<{ Params: { id: string } }>('/opportunities/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteOpportunity(contextFrom(request), id);
      return reply.status(204).send();
    });

    protectedApp.post<{ Params: { leadId: string }; Body: unknown }>(
      '/leads/:leadId/convert',
      async (request, reply) => {
        const { leadId } = request.params;
        const body = convertLeadSchema.parse(request.body);
        const opportunity = await controller.convertLead(contextFrom(request), leadId, body.estimatedValue, body);
        return reply.status(201).send({ success: true, opportunity, message: 'Lead convertida com sucesso!' });
      }
    );

    protectedApp.post<{ Params: { opportunityId: string } }>(
      '/opportunities/:opportunityId/win',
      async (request, reply) => {
        const { opportunityId } = request.params;
        const customer = await controller.winOpportunity(contextFrom(request), opportunityId);
        return reply.status(200).send(customer);
      }
    );

    protectedApp.get('/customers', async (request, reply) => {
      const customers = await controller.listCustomers(contextFrom(request));
      return reply.status(200).send(customers);
    });

    protectedApp.get('/dashboard', async (request, reply) => {
      const metrics = await controller.dashboardMetrics(contextFrom(request));
      return reply.status(200).send(metrics);
    });

    // =========================================================================
    // ATIVIDADES, TAREFAS & TIMELINE CRONOLÓGICA (FASE B3)
    // =========================================================================

    protectedApp.get('/activities', async (request, reply) => {
      const query = request.query as any;
      const filters = {
        companyId: query.companyId || undefined,
        opportunityId: query.opportunityId || undefined,
        contactId: query.contactId || undefined,
        leadId: query.leadId || undefined,
        status: query.status || undefined,
        type: query.type || undefined,
        overdueOnly: query.overdueOnly === 'true' || query.overdueOnly === true,
        limit: query.limit ? parseInt(query.limit, 10) : undefined
      };
      const activities = await controller.listActivities(contextFrom(request), filters);
      return reply.status(200).send(activities);
    });

    protectedApp.get('/activities/pending', async (request, reply) => {
      const pendingSummary = await controller.getPendingActivities(contextFrom(request));
      return reply.status(200).send(pendingSummary);
    });

    protectedApp.post('/activities', async (request, reply) => {
      const data = createActivitySchema.parse(request.body);
      const activity = await controller.createActivity(contextFrom(request), data);
      return reply.status(201).send({ success: true, activity, message: 'Atividade registada com sucesso!' });
    });

    protectedApp.patch<{ Params: { id: string } }>('/activities/:id/complete', async (request, reply) => {
      const { id } = request.params;
      const body = completeActivitySchema.parse(request.body || {});
      const activity = await controller.completeActivity(contextFrom(request), id, body.notes ?? undefined);
      return reply.status(200).send({ success: true, activity, message: 'Atividade concluída!' });
    });

    protectedApp.put<{ Params: { id: string } }>('/activities/:id', async (request, reply) => {
      const { id } = request.params;
      const data = updateActivitySchema.parse(request.body);
      const activity = await controller.updateActivity(contextFrom(request), id, data);
      return reply.status(200).send({ success: true, activity, message: 'Atividade atualizada!' });
    });

    protectedApp.delete<{ Params: { id: string } }>('/activities/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteActivity(contextFrom(request), id);
      return reply.status(204).send();
    });
  });
}
