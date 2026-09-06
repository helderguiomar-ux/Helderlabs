import { FastifyInstance } from 'fastify';
import { FinancasController } from '../controllers/FinancasController';

export async function financasRoutes(app: FastifyInstance) {
  // All routes inside require authentication and entitlement to 'financas' module
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', async (request, reply) => {
      await app.authenticate(request, reply);
      await app.requireApp('financas')(request, reply);
    });

    // Categorias
    protectedApp.get('/categories', FinancasController.listCategories);
    protectedApp.post('/categories', FinancasController.createCategory);

    // Transações
    protectedApp.get('/transactions', FinancasController.listTransactions);
    protectedApp.post('/transactions', FinancasController.createTransaction);
    protectedApp.put('/transactions/:id', FinancasController.updateTransaction);
    protectedApp.patch('/transactions/:id/pay', FinancasController.payTransaction);
    protectedApp.delete('/transactions/:id', FinancasController.deleteTransaction);

    // Recorrências
    protectedApp.get('/recurring', FinancasController.listRecurringRules);
    protectedApp.post('/recurring', FinancasController.createRecurringRule);
    protectedApp.post('/recurring/materialize', FinancasController.materializeRecurring);

    // Empréstimos
    protectedApp.get('/loans', FinancasController.listLoans);
    protectedApp.post('/loans', FinancasController.createLoan);
    protectedApp.post('/loans/:id/payments', FinancasController.recordLoanPayment);

    // Orçamentos
    protectedApp.get('/budgets', FinancasController.listBudgets);
    protectedApp.post('/budgets', FinancasController.upsertBudget);

    // Dashboard & Relatórios
    protectedApp.get('/dashboard', FinancasController.getDashboard);
    protectedApp.get('/export', FinancasController.exportData);

    // RGPD
    protectedApp.delete('/gdpr/anonymize', FinancasController.anonymizeGdpr);
  });
}
