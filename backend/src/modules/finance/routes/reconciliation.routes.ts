import { FastifyInstance } from 'fastify';
import { BankReconciliationController } from '../controllers/BankReconciliationController';

export async function reconciliationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', BankReconciliationController.listReconciliations);
  app.post('/', BankReconciliationController.createReconciliation);
  app.post('/reconcile-transaction', BankReconciliationController.reconcileTransaction);
}
