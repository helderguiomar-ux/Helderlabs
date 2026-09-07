import { FastifyInstance } from 'fastify';
import { FinanceDashboardController } from '../controllers/DashboardController';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', FinanceDashboardController.getDashboard);
  app.get('/cashflow-projection', FinanceDashboardController.getCashFlowProjection);
}
