import { FastifyInstance } from 'fastify';
import { SellmaisController } from '../controllers/SellmaisController';

export async function sellmaisRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    // Both authenticate AND requireApp('sellmais') applied on all endpoints
    protectedApp.addHook('preHandler', async (request, reply) => {
      await app.authenticate(request, reply);
      await app.requireApp('sellmais')(request, reply);
    });

    // -----------------------------------------------------------------------
    // TIPOS DE ARTIGO & ATRIBUTOS DINÂMICOS
    // -----------------------------------------------------------------------
    protectedApp.get('/types', SellmaisController.listTypes);
    protectedApp.get('/item-types', SellmaisController.listTypes);
    protectedApp.post('/types', SellmaisController.createType);
    protectedApp.post('/item-types', SellmaisController.createType);
    protectedApp.put('/types/:id', SellmaisController.updateType);
    protectedApp.delete('/types/:id', SellmaisController.deleteType);

    // -----------------------------------------------------------------------
    // LOCALIZAÇÕES FÍSICAS
    // -----------------------------------------------------------------------
    protectedApp.get('/locations', SellmaisController.listLocations);
    protectedApp.post('/locations', SellmaisController.createLocation);
    protectedApp.delete('/locations/:id', SellmaisController.deleteLocation);

    // -----------------------------------------------------------------------
    // INVENTÁRIO & ARTIGOS
    // -----------------------------------------------------------------------
    protectedApp.get('/items', SellmaisController.listItems);
    protectedApp.post('/items', SellmaisController.createItem);
    protectedApp.get('/items/:id', SellmaisController.getItem);
    protectedApp.put('/items/:id', SellmaisController.updateItem);
    protectedApp.delete('/items/:id', SellmaisController.deleteItem);
    protectedApp.post('/items/:id/restore', SellmaisController.restoreItem);

    // -----------------------------------------------------------------------
    // TRANSIÇÃO DE ESTADO
    // -----------------------------------------------------------------------
    protectedApp.post('/items/:id/transition', SellmaisController.transitionState);

    // -----------------------------------------------------------------------
    // CUSTOS & MATERIALIZAÇÃO
    // -----------------------------------------------------------------------
    protectedApp.get('/items/:id/costs', SellmaisController.listCosts);
    protectedApp.post('/items/:id/costs', SellmaisController.addCost);
    protectedApp.delete('/costs/:costId', SellmaisController.deleteCost);

    // -----------------------------------------------------------------------
    // CONSIGNAÇÕES
    // -----------------------------------------------------------------------
    protectedApp.get('/consignments', SellmaisController.listConsignments);
    protectedApp.post('/consignments', SellmaisController.createConsignment);
    protectedApp.post('/consignments/:id/items', SellmaisController.linkConsignmentItem);
    protectedApp.post('/consignments/:id/items/:itemId/settle', SellmaisController.settleConsignmentItem);

    // -----------------------------------------------------------------------
    // CANAIS EXTERNOS & OUTBOX
    // -----------------------------------------------------------------------
    protectedApp.get('/channels', SellmaisController.listChannels);
    protectedApp.post('/channels', SellmaisController.createChannel);
    protectedApp.get('/channels/listings', SellmaisController.listListings);
    protectedApp.post('/channels/jobs/process', SellmaisController.processChannelJobs);

    // -----------------------------------------------------------------------
    // LEILÕES & LICITAÇÕES
    // -----------------------------------------------------------------------
    protectedApp.get('/auctions', SellmaisController.listAuctions);
    protectedApp.post('/auctions', SellmaisController.createAuction);
    protectedApp.post('/auctions/:id/lots', SellmaisController.addAuctionLot);
    protectedApp.post('/auctions/:id/lots/:lotId/bid', SellmaisController.placeBid);
    protectedApp.post('/lots/:lotId/bid', SellmaisController.placeBid);

    // -----------------------------------------------------------------------
    // VALORIZAÇÃO DE INVENTÁRIO
    // -----------------------------------------------------------------------
    protectedApp.get('/valuation', SellmaisController.getValuation);
  });
}
