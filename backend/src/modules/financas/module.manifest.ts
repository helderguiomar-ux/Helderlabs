import { seedFinancas } from './services/seedFinancas';

export const manifest = {
  key: 'financas',
  name: 'Finanças',
  icon: 'credit-card',
  color: '#10b981',
  routePrefix: '/api/financas',
  frontendEntry: '/app.html#/financas',
  permissions: ['financas.read', 'financas.write', 'financas.admin'],
  features: ['transactions', 'recurrences', 'loans', 'budgets', 'reports'],
  defaultLimits: { transacoes: 10000 },
  seed: async (tenantId: string) => {
    await seedFinancas(tenantId);
  }
};
