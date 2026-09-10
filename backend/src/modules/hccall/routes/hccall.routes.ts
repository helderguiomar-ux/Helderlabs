import { FastifyInstance } from 'fastify';
import { HccallController } from '../controllers/HccallController';

export async function hccallRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    // Autenticação e Verificação de Atribuição da Aplicação HCCALL
    protectedApp.addHook('preHandler', async (request, reply) => {
      await app.authenticate(request, reply);
      await app.requireApp('hccall')(request, reply);
    });

    // 1. Contexto Organizacional Historizado
    protectedApp.get('/context', HccallController.getCurrentContext);
    protectedApp.post('/context/switch', HccallController.switchContext);

    // 2. Catálogo de Produtos Configurável
    protectedApp.get('/products', HccallController.listProducts);
    protectedApp.post('/products', HccallController.createProduct);
    protectedApp.put('/products/:id', HccallController.updateProduct);
    protectedApp.delete('/products/:id', HccallController.deleteProduct);

    // 3. Dinamizações & Regras Comerciais
    protectedApp.get('/dynamizations', HccallController.listDynamizations);
    protectedApp.post('/dynamizations', HccallController.createDynamization);
    protectedApp.get('/dynamizations/:id', HccallController.getDynamization);
    protectedApp.put('/dynamizations/:id', HccallController.updateDynamization);

    // 4. Vendas
    protectedApp.get('/sales', HccallController.listSales);
    protectedApp.post('/sales', HccallController.createSale);
    protectedApp.get('/sales/:id', HccallController.getSale);
    protectedApp.put('/sales/:id', HccallController.updateSale);
    protectedApp.delete('/sales/:id', HccallController.deleteSale);

    // 5. Objetivos Comerciais Multi-Dimensão
    protectedApp.get('/objectives', HccallController.listObjectives);
    protectedApp.post('/objectives', HccallController.createObjective);

    // 6. Performance & Calendário
    protectedApp.get('/performance', HccallController.getPerformance);

    // 7. Alertas Determinísticos
    protectedApp.get('/alerts', HccallController.getAlerts);
    protectedApp.delete('/alerts/:id', HccallController.dismissAlert);

    // 8. Simulador "E se..."
    protectedApp.post('/simulate', HccallController.simulate);

    // 9. Sincronização Offline Idempotente
    protectedApp.post('/sync', HccallController.syncOfflineBatch);

    // 10. Stream de Eventos em Tempo Real (SSE)
    protectedApp.get('/events', HccallController.streamEvents);

    // 11. Retrocompatibilidade Canónica (v1)
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

    protectedApp.get('/customers', HccallController.listCustomers);
    protectedApp.get('/customers/:id', HccallController.getCustomer);
    protectedApp.post('/customers/:id/contacts', HccallController.addContact);
    protectedApp.delete('/customers/:id/anonymize', HccallController.anonymizeCustomer);

    protectedApp.get('/dashboard', HccallController.getDashboard);
    protectedApp.get('/reports/commissions', HccallController.getDashboard);
    protectedApp.get('/export', HccallController.exportSalesCsv);
    protectedApp.get('/reports/export.csv', HccallController.exportSalesCsv);
  });
}
