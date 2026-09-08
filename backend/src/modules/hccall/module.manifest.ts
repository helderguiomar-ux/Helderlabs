export const manifest = {
  key: 'hccall',
  name: 'HCCALL Telecom',
  icon: 'headset',
  color: '#0d419f',
  routePrefix: '/api/hccall',
  frontendEntry: '/hccall.html',
  permissions: ['hccall.use'],
  features: ['offline', 'commissions', 'promotions'],
  defaultLimits: { vendas: 50000, clientes: 20000 }
};
