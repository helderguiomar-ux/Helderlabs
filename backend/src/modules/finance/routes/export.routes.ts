import { FastifyInstance } from 'fastify';
import { ExportController } from '../controllers/ExportController';

export async function exportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/csv', ExportController.exportCsv);
  app.get('/saft', ExportController.exportSaft);
}
