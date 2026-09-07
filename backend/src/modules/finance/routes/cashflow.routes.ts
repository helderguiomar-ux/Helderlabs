import { FastifyInstance } from 'fastify';
import { CashFlowController } from '../controllers/CashFlowController';

export async function cashflowRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/projection', CashFlowController.getProjections);
}
