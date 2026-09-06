import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CRMController, type CRMRequestContext } from '../controllers/CRMController';
import { EnterpriseCRMService } from '../services/EnterpriseCRMService';

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

function contextFrom(request: { user?: { tenantId: string }; db?: unknown }): CRMRequestContext {
  if (!request.user || !request.db) {
    throw new Error('Rota CRM chamada sem autenticação — falta o preHandler app.authenticate.');
  }
  return { tenantId: request.user.tenantId, db: request.db as CRMRequestContext['db'] };
}

const publicLeadSchema = z.object({
  name: z.string().min(1),
  company: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  sector: z.string().optional(),
  message: z.string().optional()
});

export async function crmRoutes(app: FastifyInstance) {
  // Rota pública de submissão da Landing Page
  app.post('/public/leads', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes'
      }
    }
  }, async (request, reply) => {
    const data = publicLeadSchema.parse(request.body);
    const lead = await EnterpriseCRMService.createPublicLead(data as any);
    return reply.status(201).send({
      success: true,
      lead,
      message: 'Diagnóstico solicitado com sucesso! Entraremos em contacto brevemente.'
    });
  });

  // Sub-bloco para endpoints estritamente protegidos do CRM
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', app.authenticate);
    protectedApp.addHook('preHandler', app.requireApp('crm'));


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
