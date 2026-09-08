export const manifest = {
  key: 'sellmais',
  name: '2SELLMAIS',
  icon: 'archive',
  color: '#9A7328',
  routePrefix: '/api/sellmais',
  frontendEntry: '/app.html#/sellmais',
  permissions: [
    'sellmais.item.read',
    'sellmais.item.write',
    'sellmais.item.delete',
    'sellmais.cost.read',
    'sellmais.price.write',
    'sellmais.channel.publish',
    'sellmais.auction.manage',
    'sellmais.consignment.manage',
    'sellmais.admin'
  ],
  features: ['inventory', 'provenance', 'media', 'channels', 'auctions', 'consignment'],
  defaultLimits: { artigos: 10000, canais: 5 }
};
