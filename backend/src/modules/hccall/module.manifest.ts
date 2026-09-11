export const manifest = {
  key: 'hccall',
  name: 'HCCALL 2.0 (Personal Sales Control)',
  icon: 'trending-up',
  color: '#0d419f',
  routePrefix: '/api/hccall',
  frontendEntry: '/hccall.html',
  permissions: ['hccall.use'],
  features: ['offline', 'commissions', 'dynamizations', 'objectives', 'performance', 'simulator'],
  defaultLimits: { vendas: 100000, clientes: 50000 }
};
