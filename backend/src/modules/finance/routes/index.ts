import { FastifyInstance } from 'fastify';
import { financeRoutes } from './finance.routes';
import { budgetsRoutes } from './budgets.routes';
import { dashboardRoutes } from './dashboard.routes';
import { reportsRoutes } from './reports.routes';
import { reconciliationRoutes } from './reconciliation.routes';
import { cashflowRoutes } from './cashflow.routes';
import { exportRoutes } from './export.routes';

export async function financeModuleRoutes(app: FastifyInstance) {
  await app.register(financeRoutes, { prefix: '/transactions' });
  await app.register(budgetsRoutes, { prefix: '/budgets' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(reportsRoutes, { prefix: '/reports' });
  await app.register(reconciliationRoutes, { prefix: '/reconciliation' });
  await app.register(cashflowRoutes, { prefix: '/cashflow' });
  await app.register(exportRoutes, { prefix: '/export' });
}
