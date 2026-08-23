import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CRMController, type CRMRequestContext } from '../controllers/CRMController';

const controller = new CRMController();

const convertLeadSchema = z.object({
  estimatedValue: z.number().positive()
});

// tenantId deixou de vir de query/body — vem sempre de request.user.tenantId,
// preenchido pelo hook app.authenticate a partir do JWT validado. Um cliente
// não consegue "escolher" outro tenant mesmo que tente enviar um tenantId
// diferente no pedido, porque este schema nem sequer aceita esse campo.
const createLeadSchema = z.object({
  company: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().min(1)
});

function contextFrom(request: { user?: { tenantId: string }; db?: unknown }): CRMRequestContext {
  // Garantido pelo preHandler `app.authenticate` registado abaixo — se
  // chegou aqui sem user/db é um erro de configuração das rotas, não um
  // caso a tratar graciosamente.
  if (!request.user || !request.db) {
    throw new Error('Rota CRM chamada sem autenticação — falta o preHandler app.authenticate.');
  }
  return { tenantId: request.user.tenantId, db: request.db as CRMRequestContext['db'] };
}

export async function crmRoutes(app: FastifyInstance) {
  // Todas as rotas deste módulo exigem um JWT válido.
  app.addHook('preHandler', app.authenticate);

  app.post('/leads', async (request, reply) => {
    const data = createLeadSchema.parse(request.body);
    const lead = await controller.createLead(contextFrom(request), data as any);
    return reply.status(201).send(lead);
  });

  app.get('/leads', async (request, reply) => {
    const leads = await controller.listLeads(contextFrom(request));
    return reply.status(200).send(leads);
  });

  app.put<{ Params: { id: string } }>('/leads/:id', async (request, reply) => {
    const { id } = request.params;
    const data = createLeadSchema.partial().parse(request.body);
    const updated = await controller.updateLead(contextFrom(request), id, data);
    return reply.status(200).send(updated);
  });

  app.delete<{ Params: { id: string } }>('/leads/:id', async (request, reply) => {
    const { id } = request.params;
    await controller.deleteLead(contextFrom(request), id);
    return reply.status(204).send();
  });

  app.get('/opportunities', async (request, reply) => {
    const opportunities = await controller.listOpportunities(contextFrom(request));
    return reply.status(200).send(opportunities);
  });

  app.get('/customers', async (request, reply) => {
    const customers = await controller.listCustomers(contextFrom(request));
    return reply.status(200).send(customers);
  });

  app.post<{ Params: { leadId: string }; Body: unknown }>(
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

  app.post<{ Params: { opportunityId: string } }>(
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

  app.get('/dashboard', async (request, reply) => {
    const metrics = await controller.dashboardMetrics(contextFrom(request));
    return reply.status(200).send(metrics);
  });
}
