import { FastifyInstance } from 'fastify';
import { FinanceController } from '../controllers/FinanceController';

export async function financeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Transações
  app.get('/', FinanceController.listTransactions);
  app.post('/', FinanceController.createTransaction);
  app.get('/:id', FinanceController.getTransaction);
  app.patch('/:id', FinanceController.updateTransaction);
  app.delete('/:id', FinanceController.deleteTransaction);
  app.post('/:id/approve', FinanceController.approveTransaction);

  // Resumos
  app.get('/summary/all', FinanceController.getSummary);
  app.get('/summary/by-category', FinanceController.getExpensesByCategory);
}
