import { FastifyRequest, FastifyReply } from 'fastify';
import { FinanceDashboardController } from './DashboardController';

export class CashFlowController {
  static async getProjections(req: FastifyRequest, reply: FastifyReply) {
    return FinanceDashboardController.getCashFlowProjection(req, reply);
  }
}
