import { FastifyInstance } from 'fastify';
import { FinancasController } from '../controllers/FinancasController';

export async function financasRoutes(app: FastifyInstance) {
  // All routes inside require authentication and entitlement to 'financas' module
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', async (request, reply) => {
      await app.authenticate(request, reply);
      await app.requireApp('financas')(request, reply);
    });

    // Contas
    protectedApp.get('/accounts', FinancasController.listAccounts);
    protectedApp.post('/accounts', FinancasController.createAccount);
    protectedApp.put('/accounts/:id', FinancasController.updateAccount);
    protectedApp.delete('/accounts/:id', FinancasController.deleteAccount);
    protectedApp.post('/accounts/:id/restore', FinancasController.restoreAccount);

    // Centros de Custo
    protectedApp.get('/cost-centers', FinancasController.listCostCenters);
    protectedApp.post('/cost-centers', FinancasController.createCostCenter);
    protectedApp.put('/cost-centers/:id', FinancasController.updateCostCenter);
    protectedApp.delete('/cost-centers/:id', FinancasController.deleteCostCenter);

    // Categorias
    protectedApp.get('/categories', FinancasController.listCategories);
    protectedApp.post('/categories', FinancasController.createCategory);
    protectedApp.put('/categories/:id', FinancasController.updateCategory);
    protectedApp.delete('/categories/:id', FinancasController.deleteCategory);
    protectedApp.post('/categories/:id/restore', FinancasController.restoreCategory);
    protectedApp.get('/categories/budget-status', FinancasController.getBudgetStatus);

    // Transações
    protectedApp.get('/transactions', FinancasController.listTransactions);
    protectedApp.post('/transactions', FinancasController.createTransaction);
    protectedApp.put('/transactions/:id', FinancasController.updateTransaction);
    protectedApp.patch('/transactions/:id/pay', FinancasController.payTransaction);
    protectedApp.patch('/transactions/:id/approve', FinancasController.approveTransaction);
    protectedApp.delete('/transactions/:id', FinancasController.deleteTransaction);
    protectedApp.post('/transactions/:id/restore', FinancasController.restoreTransaction);

    // Anexos
    protectedApp.get('/transactions/:id/attachments', FinancasController.listAttachments);
    protectedApp.post('/transactions/:id/attachments', FinancasController.createAttachment);
    protectedApp.delete('/attachments/:attachmentId', FinancasController.deleteAttachment);

    // Recorrências
    protectedApp.get('/recurring', FinancasController.listRecurringRules);
    protectedApp.post('/recurring', FinancasController.createRecurringRule);
    protectedApp.delete('/recurring/:id', FinancasController.deleteRecurringRule);
    protectedApp.post('/recurring/materialize', FinancasController.materializeRecurring);

    // Empréstimos
    protectedApp.get('/loans', FinancasController.listLoans);
    protectedApp.post('/loans', FinancasController.createLoan);
    protectedApp.delete('/loans/:id', FinancasController.deleteLoan);
    protectedApp.post('/loans/:id/payments', FinancasController.recordLoanPayment);

    // Dashboard, Projeções & Análise
    protectedApp.get('/dashboard', FinancasController.getDashboard);
    protectedApp.get('/kpis', FinancasController.getDashboard);
    protectedApp.get('/projections', FinancasController.getCashFlowProjections);
    protectedApp.get('/burn-rate', FinancasController.getBurnRate);
    protectedApp.get('/export', FinancasController.exportData);

    // RGPD
    protectedApp.delete('/gdpr/anonymize', FinancasController.anonymizeGdpr);
  });
}
