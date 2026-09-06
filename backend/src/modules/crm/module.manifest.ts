export const manifest = {
  key: 'crm',
  name: 'CRM',
  icon: 'users',
  color: '#0d419f',
  routePrefix: '/api/crm',
  frontendEntry: '/app.html#/crm',
  permissions: ['crm.lead.read', 'crm.lead.write', 'crm.opportunity.manage'],
  features: ['pipeline', 'email_sync'],
  defaultLimits: { contactos: 5000 }
};
