export const manifest = {
  key: 'condominios',
  name: 'Condomínios',
  icon: 'building',
  color: '#2563eb',
  routePrefix: '/api/condominios',
  frontendEntry: '/app.html#/condominios',
  permissions: ['condominios.building.read', 'condominios.building.write'],
  features: ['fraction_management', 'assembly_votes'],
  defaultLimits: { edificios: 50 }
};
