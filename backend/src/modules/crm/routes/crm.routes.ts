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

const proposalStatusEnum = z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

const proposalItemInputSchema = z.object({
  description: z.string().trim().min(1, 'Descrição do item é obrigatória.'),
  quantity: z.number().positive('Quantidade tem de ser positiva.').default(1.0),
  unitPriceCents: z.number().int().min(0, 'Preço unitário em cêntimos não pode ser negativo.'),
  discountPercent: z.number().min(0).max(100).optional().default(0.0),
  vatRatePercent: z.number().min(0).max(100).optional().default(23.0),
  sortOrder: z.number().int().optional()
});

const createProposalSchema = z
  .object({
    title: z.string().trim().min(1, 'Título da proposta é obrigatório.'),
    proposalNumber: z.string().trim().optional(),
    companyId: z.string().optional().nullable(),
    contactId: z.string().optional().nullable(),
    opportunityId: z.string().optional().nullable(),
    issueDate: z.string().optional().nullable(),
    validUntil: z.string().optional().nullable(),
    vatRatePercent: z.number().min(0).max(100).optional().default(23.0),
    notes: z.string().optional().nullable(),
    termsAndConditions: z.string().optional().nullable(),
    items: z.array(proposalItemInputSchema).min(1, 'A proposta tem de conter pelo menos um item.')
  })
  .strict();

const updateProposalSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    companyId: z.string().optional().nullable(),
    contactId: z.string().optional().nullable(),
    opportunityId: z.string().optional().nullable(),
    issueDate: z.string().optional().nullable(),
    validUntil: z.string().optional().nullable(),
    vatRatePercent: z.number().min(0).max(100).optional(),
    notes: z.string().optional().nullable(),
    termsAndConditions: z.string().optional().nullable(),
    items: z.array(proposalItemInputSchema).optional()
  })
  .strict();

const updateProposalStatusSchema = z
  .object({
    status: z.enum(['ACCEPTED', 'REJECTED', 'SENT']),
    reason: z.string().trim().optional().nullable()
  })
  .strict();

const sendProposalEmailSchema = z
  .object({
    recipientEmail: z.string().trim().toLowerCase().email('Email inválido.').optional().nullable().or(z.literal('')),
    message: z.string().trim().optional().nullable()
  })
  .strict();

const createAccountEntrySchema = z
  .object({
    type: z.enum([
      'OPENING_BALANCE',
      'INVOICE',
      'DEBIT_NOTE',
      'CREDIT_NOTE',
      'PAYMENT',
      'REFUND',
      'ADJUSTMENT',
      'REVERSAL'
    ]),
    amountCents: z.number().int().positive('O montante deve ser um número inteiro positivo em cêntimos.'),
    entryDate: z.string().optional().nullable(),
    externalDocumentNumber: z.string().trim().optional().nullable(),
    dueDate: z.string().optional().nullable(),
    method: z.string().trim().optional().nullable(),
    reference: z.string().trim().optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    proposalId: z.string().optional().nullable(),
    autoAllocate: z.boolean().optional().default(false)
  })
  .strict();

const allocatePaymentSchema = z
  .object({
    paymentEntryId: z.string().min(1, 'ID do lançamento de pagamento é obrigatório.'),
    documentEntryId: z.string().min(1, 'ID do documento a liquidar é obrigatório.'),
    amountCents: z.number().int().positive('Montante a alocar deve ser um inteiro positivo em cêntimos.')
  })
  .strict();

const reverseEntrySchema = z
  .object({
    reason: z.string().trim().min(1, 'Motivo do estorno é obrigatório.')
  })
  .strict();

const sendStatementEmailSchema = z
  .object({
    to: z.string().trim().toLowerCase().email('Email de destino inválido.'),
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

const createDocumentSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome do documento é obrigatório.'),
    docType: z.string().optional().default('OTHER'),
    category: z.string().optional(),
    fileUrl: z.string().optional().nullable(),
    fileName: z.string().optional().nullable(),
    fileSizeBytes: z.number().int().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    accessCode: z.string().optional().nullable(),
    issueDate: z.string().optional().nullable(),
    expiryDate: z.string().optional().nullable(),
    expiresAt: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
  })
  .strict();

const updateDocumentSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    docType: z.string().optional(),
    fileUrl: z.string().optional().nullable(),
    fileName: z.string().optional().nullable(),
    fileSizeBytes: z.number().int().optional().nullable(),
    mimeType: z.string().optional().nullable(),
    accessCode: z.string().optional().nullable(),
    issueDate: z.string().optional().nullable(),
    expiryDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    status: z.string().optional()
  })
  .strict();

const verifyDocumentSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED']),
    notes: z.string().optional().nullable()
  })
  .strict();

const listDocumentsQuerySchema = z
  .object({
    companyId: z.string().optional(),
    docType: z.string().optional(),
    status: z.string().optional(),
    verificationStatus: z.string().optional(),
    daysAhead: z.coerce.number().int().optional(),
    expiringOnly: z.coerce.boolean().optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional()
  })
  .strict();

const contractSchema = z
  .object({
    companyId: z.string().optional(),
    proposalId: z.string().optional().nullable(),
    contractNumber: z.string().trim().optional(),
    title: z.string().trim().min(1, 'Título do contrato é obrigatório'),
    type: z.string().optional().default('SERVICE'),
    status: z.string().optional().default('ACTIVE'),
    valueCents: z.number().int().optional(),
    monthlyValueCents: z.number().int().optional().nullable(),
    annualValueCents: z.number().int().optional().nullable(),
    totalValueCents: z.number().int().optional().nullable(),
    billingFrequency: z.enum(['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'ONE_OFF']).optional().default('MONTHLY'),
    isIndefinite: z.boolean().optional().default(false),
    autoRenew: z.boolean().optional().default(false),
    startDate: z.string().min(1, 'Data de início é obrigatória'),
    endDate: z.string().optional().nullable(),
    slaLevel: z.string().optional().default('STANDARD'),
    slaResponseHours: z.number().int().positive().optional().nullable(),
    slaResolutionHours: z.number().int().positive().optional().nullable(),
    renewalNoticeDays: z.number().int().optional().default(30),
    noticePeriodDays: z.number().int().optional(),
    documentUrl: z.string().optional().nullable(),
    termsAndConditions: z.string().optional().nullable(),
    terms: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
  })
  .strict();

const renewContractSchema = z
  .object({
    extensionMonths: z.number().int().positive().optional().default(12),
    newEndDate: z.string().optional().nullable(),
    adjustmentPercent: z.number().optional().default(0),
    notes: z.string().optional().nullable()
  })
  .strict();

const terminateContractSchema = z
  .object({
    reason: z.string().trim().min(1, 'Motivo de rescisão/cancelamento é obrigatório.'),
    cancelledAt: z.string().optional()
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
    // DOCUMENTOS & COMPLIANCE (FASE B6)
    // =======================================================================
    protectedApp.get<{ Params: { id: string } }>('/companies/:id/documents', async (request, reply) => {
      const { id } = request.params;
      const query = request.query as { docType?: string; status?: string; verificationStatus?: string; includeDeleted?: string };
      const result = await controller.listCompanyDocuments(contextFrom(request), id, {
        docType: query.docType,
        status: query.status,
        verificationStatus: query.verificationStatus,
        includeDeleted: query.includeDeleted === 'true'
      });
      return reply.status(200).send({ success: true, ...result });
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/documents', async (request, reply) => {
      const { id } = request.params;
      const data = createDocumentSchema.parse(request.body);
      const document = await controller.addCompanyDocument(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, document });
    });

    protectedApp.get('/documents', async (request, reply) => {
      const query = listDocumentsQuerySchema.parse(request.query);
      const result = await controller.listTenantDocuments(contextFrom(request), query);
      return reply.status(200).send({ success: true, ...result });
    });

    protectedApp.get<{ Params: { docId: string } }>('/documents/:docId', async (request, reply) => {
      const { docId } = request.params;
      const document = await controller.getDocument(contextFrom(request), docId);
      return reply.status(200).send({ success: true, document });
    });

    protectedApp.put<{ Params: { docId: string } }>('/documents/:docId', async (request, reply) => {
      const { docId } = request.params;
      const data = updateDocumentSchema.parse(request.body);
      const document = await controller.updateCompanyDocument(contextFrom(request), docId, data);
      return reply.status(200).send({ success: true, document });
    });

    protectedApp.patch<{ Params: { docId: string } }>('/documents/:docId/verify', async (request, reply) => {
      const { docId } = request.params;
      const data = verifyDocumentSchema.parse(request.body);
      const document = await controller.verifyCompanyDocument(contextFrom(request), docId, data);
      return reply.status(200).send({ success: true, document });
    });

    protectedApp.delete<{ Params: { docId: string } }>('/documents/:docId', async (request, reply) => {
      const { docId } = request.params;
      await controller.deleteCompanyDocument(contextFrom(request), docId);
      return reply.status(200).send({ success: true, message: 'Documento arquivado com sucesso.' });
    });

    protectedApp.get('/contracts', async (request, reply) => {
      const query = request.query as {
        companyId?: string;
        status?: string;
        expiringDays?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };
      const result = await controller.listContracts(contextFrom(request), {
        companyId: query.companyId,
        status: query.status,
        expiringDays: query.expiringDays ? parseInt(query.expiringDays, 10) : undefined,
        search: query.search,
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0
      });
      return reply.status(200).send({
        success: true,
        contracts: result.items || result,
        items: result.items || result,
        total: result.total ?? (Array.isArray(result) ? result.length : 0),
        kpis: result.kpis
      });
    });

    protectedApp.get<{ Params: { contractId: string } }>('/contracts/:contractId', async (request, reply) => {
      const { contractId } = request.params;
      const contract = await controller.getContract(contextFrom(request), contractId);
      return reply.status(200).send({ success: true, contract });
    });

    protectedApp.get<{ Params: { contractId: string } }>('/contracts/:contractId/summary', async (request, reply) => {
      const { contractId } = request.params;
      const html = await controller.renderContractSummaryHtml(contextFrom(request), contractId);
      return reply.type('text/html; charset=utf-8').send(html);
    });

    protectedApp.post('/contracts', async (request, reply) => {
      const data = contractSchema.parse(request.body);
      const contract = await controller.createContract(contextFrom(request), data);
      return reply.status(201).send({ success: true, contract });
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

    protectedApp.patch<{ Params: { contractId: string } }>('/contracts/:contractId/renew', async (request, reply) => {
      const { contractId } = request.params;
      const data = renewContractSchema.parse(request.body);
      const contract = await controller.renewContract(contextFrom(request), contractId, data);
      return reply.status(200).send({ success: true, contract });
    });

    protectedApp.patch<{ Params: { contractId: string } }>('/contracts/:contractId/terminate', async (request, reply) => {
      const { contractId } = request.params;
      const data = terminateContractSchema.parse(request.body);
      const contract = await controller.terminateContract(contextFrom(request), contractId, data);
      return reply.status(200).send({ success: true, contract });
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

    // =========================================================================
    // PROPOSTAS COMERCIAIS & ORÇAMENTOS (FASE B4)
    // =========================================================================

    protectedApp.get('/proposals', async (request, reply) => {
      const query = request.query as any;
      const filters = {
        companyId: query.companyId || undefined,
        opportunityId: query.opportunityId || undefined,
        status: query.status || undefined,
        search: query.search || undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined
      };
      const proposals = await controller.listProposals(contextFrom(request), filters);
      return reply.status(200).send(proposals);
    });

    protectedApp.get<{ Params: { id: string } }>('/proposals/:id', async (request, reply) => {
      const { id } = request.params;
      const proposal = await controller.getProposal(contextFrom(request), id);
      return reply.status(200).send(proposal);
    });

    protectedApp.get<{ Params: { id: string } }>('/proposals/:id/print', async (request, reply) => {
      const { id } = request.params;
      const html = await controller.renderProposalHtml(contextFrom(request), id);
      return reply.type('text/html; charset=utf-8').send(html);
    });

    protectedApp.post('/proposals', async (request, reply) => {
      const data = createProposalSchema.parse(request.body);
      const proposal = await controller.createProposal(contextFrom(request), data);
      return reply.status(201).send({ success: true, proposal, message: 'Proposta comercial registada com sucesso!' });
    });

    protectedApp.put<{ Params: { id: string } }>('/proposals/:id', async (request, reply) => {
      const { id } = request.params;
      const data = updateProposalSchema.parse(request.body);
      const proposal = await controller.updateProposal(contextFrom(request), id, data);
      return reply.status(200).send({ success: true, proposal, message: 'Proposta atualizada!' });
    });

    protectedApp.delete<{ Params: { id: string } }>('/proposals/:id', async (request, reply) => {
      const { id } = request.params;
      await controller.deleteProposal(contextFrom(request), id);
      return reply.status(204).send();
    });

    protectedApp.patch<{ Params: { id: string } }>('/proposals/:id/status', async (request, reply) => {
      const { id } = request.params;
      const body = updateProposalStatusSchema.parse(request.body);
      const proposal = await controller.updateProposalStatus(contextFrom(request), id, body.status, body.reason ?? undefined);
      return reply.status(200).send({ success: true, proposal, message: `Estado da proposta atualizado para ${body.status}!` });
    });

    protectedApp.post<{ Params: { id: string } }>('/proposals/:id/send', async (request, reply) => {
      const { id } = request.params;
      const body = sendProposalEmailSchema.parse(request.body || {});
      const actor = {
        userId: (request.user as any)?.sub || (request.user as any)?.id,
        email: (request.user as any)?.email,
        role: (request.user as any)?.role,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      };
      const result = await controller.sendProposalEmail(contextFrom(request), id, body, actor);
      return reply.status(200).send({ success: true, result, message: 'Proposta enviada por email com sucesso!' });
    });

    // =========================================================================
    // CONTA CORRENTE DE CLIENTES (FASE B7)
    // =========================================================================

    protectedApp.get<{ Params: { id: string } }>('/companies/:id/account/statement', async (request, reply) => {
      const { id } = request.params;
      const query = request.query as any;
      const statement = await controller.getCustomerStatement(contextFrom(request), id, query);
      return reply.status(200).send(statement);
    });

    protectedApp.get<{ Params: { id: string } }>('/companies/:id/account/balances', async (request, reply) => {
      const { id } = request.params;
      const balances = await controller.getCustomerBalances(contextFrom(request), id);
      return reply.status(200).send(balances);
    });

    protectedApp.get<{ Params: { id: string } }>('/companies/:id/account/statement/print', async (request, reply) => {
      const { id } = request.params;
      const query = request.query as any;
      const html = await controller.renderStatementHtml(contextFrom(request), id, query);
      return reply.type('text/html; charset=utf-8').send(html);
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/account/entries', async (request, reply) => {
      const { id } = request.params;
      const data = createAccountEntrySchema.parse(request.body);
      const entry = await controller.createAccountEntry(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, entry, message: 'Lançamento de conta corrente registado com sucesso!' });
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/account/allocate', async (request, reply) => {
      const { id } = request.params;
      const data = allocatePaymentSchema.parse(request.body);
      const allocation = await controller.allocatePayment(contextFrom(request), id, data);
      return reply.status(201).send({ success: true, allocation, message: 'Alocação de pagamento efetuada com sucesso!' });
    });

    protectedApp.post<{ Params: { id: string } }>('/account/entries/:id/reverse', async (request, reply) => {
      const { id } = request.params;
      const body = reverseEntrySchema.parse(request.body || {});
      const result = await controller.createReversal(contextFrom(request), id, body.reason);
      return reply.status(200).send({ ...result, message: 'Lançamento estornado com sucesso!' });
    });

    protectedApp.get('/account/balances/summary', async (request, reply) => {
      const summary = await controller.getGlobalAccountSummary(contextFrom(request));
      return reply.status(200).send(summary);
    });

    protectedApp.post<{ Params: { id: string } }>('/companies/:id/account/statement/send', async (request, reply) => {
      const { id } = request.params;
      const body = sendStatementEmailSchema.parse(request.body || {});
      const actor = {
        userId: (request.user as any)?.sub || (request.user as any)?.id,
        email: (request.user as any)?.email,
        role: (request.user as any)?.role,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      };
      const result = await controller.sendStatementEmail(contextFrom(request), id, body, actor);
      return reply.status(200).send({ success: true, result, message: 'Extrato enviado por email com sucesso!' });
    });
  });
}
