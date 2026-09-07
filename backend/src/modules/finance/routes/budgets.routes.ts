import { FastifyInstance } from 'fastify';
import { BudgetController } from '../controllers/BudgetController';

export async function budgetsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', BudgetController.listBudgets);
  app.post('/', BudgetController.createBudget);
  app.get('/:id/analysis', BudgetController.analyzeBudget);
  app.post('/:id/approve', BudgetController.approveBudget);
}
