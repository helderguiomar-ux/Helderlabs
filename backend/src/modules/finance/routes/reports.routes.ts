import { FastifyInstance } from 'fastify';
import { ReportsController } from '../controllers/ReportsController';

export async function reportsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/', ReportsController.generateReport);
  app.get('/:id', ReportsController.getReport);
}
