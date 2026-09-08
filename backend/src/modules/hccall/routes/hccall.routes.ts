import { FastifyInstance } from 'fastify';
import { HccallController } from '../controllers/HccallController';

export async function hccallRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    // Both authenticate AND requireApp('hccall') applied on all endpoints
    protectedApp.addHook('preHandler', async (request, reply) => {
      await app.authenticate(request, reply);
      await app.requireApp('hccall')(request, reply);
    });

    // -----------------------------------------------------------------------
    // CONFIGURAÇÃO (SERVIÇOS, DINAMIZAÇÕES, ESTADOS)
    // -----------------------------------------------------------------------
    protectedApp.get('/services', HccallController.listServices);
    protectedApp.post('/services', HccallController.createService);
    protectedApp.put('/services/:id', HccallController.updateService);
    protectedApp.delete('/services/:id', HccallController.deleteService);

    protectedApp.get('/promotions', HccallController.listPromotions);
    protectedApp.post('/promotions', HccallController.createPromotion);
    protectedApp.put('/promotions/:id', HccallController.updatePromotion);
    protectedApp.delete('/promotions/:id', HccallController.deletePromotion);

    protectedApp.get('/statuses', HccallController.listStatuses);
    protectedApp.post('/statuses', HccallController.createStatus);
    protectedApp.put('/statuses/:id', HccallController.updateStatus);
    protectedApp.delete('/statuses/:id', HccallController.deleteStatus);

    // -----------------------------------------------------------------------
    // VENDAS OPERACIONAIS
    // -----------------------------------------------------------------------
    protectedApp.get('/sales', HccallController.listSales);
    protectedApp.post('/sales', HccallController.createSale);
    protectedApp.get('/sales/:id', HccallController.getSale);
    protectedApp.put('/sales/:id', HccallController.updateSale);
    protectedApp.delete('/sales/:id', HccallController.deleteSale);
    protectedApp.post('/sales/:id/restore', HccallController.restoreSale);

    // -----------------------------------------------------------------------
    // CLIENTES & CONTACTOS
    // -----------------------------------------------------------------------
    protectedApp.get('/customers', HccallController.listCustomers);
    protectedApp.get('/customers/:id', HccallController.getCustomer);
    protectedApp.post('/customers/:id/contacts', HccallController.addContact);
    protectedApp.delete('/customers/:id/anonymize', HccallController.anonymizeCustomer);

    // -----------------------------------------------------------------------
    // DASHBOARD, RELATÓRIOS & EXPORTAÇÕES
    // -----------------------------------------------------------------------
    protectedApp.get('/dashboard', HccallController.getDashboard);
    protectedApp.get('/reports/commissions', HccallController.getDashboard);
    protectedApp.get('/export', HccallController.exportSalesCsv);
    protectedApp.get('/reports/export.csv', HccallController.exportSalesCsv);

    // -----------------------------------------------------------------------
    // SINCRONIZAÇÃO OFFLINE IDEMPOTENTE
    // -----------------------------------------------------------------------
    protectedApp.post('/sync', HccallController.syncOfflineBatch);

    // -----------------------------------------------------------------------
    // CONSULTAS IA SEGURAS (READ-ONLY)
    // -----------------------------------------------------------------------
    protectedApp.post('/ai/query', HccallController.handleAiQuery);
  });
}
