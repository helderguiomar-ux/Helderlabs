import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CondominiosController, type CondominiosRequestContext } from '../controllers/CondominiosController';
import { BuildingNotFoundError } from '../services/EnterpriseCondominiosService';

const controller = new CondominiosController();

const createBuildingSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  municipality: z.string().min(1),
  taxNumber: z.string().optional(),
  totalPermille: z.number().int().positive().optional()
});

const createUnitSchema = z.object({
  identifier: z.string().min(1),
  permille: z.number().int().positive()
});

function contextFrom(request: { user?: { tenantId: string }; db?: unknown }): CondominiosRequestContext {
  if (!request.user || !request.db) {
    throw new Error('Rota Condomínios chamada sem autenticação — falta o preHandler app.authenticate.');
  }
  return { tenantId: request.user.tenantId, db: request.db as CondominiosRequestContext['db'] };
}

// CRUD mínimo (Building + Unit) — provar que o modelo de dados funciona na
// prática antes de construir Owner/Fee/Assembly/Vote/Expense e UI completa
// (ver README, secção "Gestão de Condomínios").
export async function condominiosRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.requireApp('condominios'));

  app.post('/buildings', async (request, reply) => {
    const data = createBuildingSchema.parse(request.body);
    const building = await controller.createBuilding(contextFrom(request), data as any);
    return reply.status(201).send(building);
  });

  app.get('/buildings', async (request, reply) => {
    const buildings = await controller.listBuildings(contextFrom(request));
    return reply.status(200).send(buildings);
  });

  app.put<{ Params: { buildingId: string } }>('/buildings/:buildingId', async (request, reply) => {
    const { buildingId } = request.params;
    const data = createBuildingSchema.partial().parse(request.body);
    try {
      const updated = await controller.updateBuilding(contextFrom(request), buildingId, data);
      return reply.status(200).send(updated);
    } catch (error) {
      if (error instanceof BuildingNotFoundError) {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });

  app.delete<{ Params: { buildingId: string } }>('/buildings/:buildingId', async (request, reply) => {
    const { buildingId } = request.params;
    try {
      await controller.deleteBuilding(contextFrom(request), buildingId);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof BuildingNotFoundError) {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });

  app.post<{ Params: { buildingId: string }; Body: unknown }>(
    '/buildings/:buildingId/units',
    async (request, reply) => {
      const { buildingId } = request.params;
      const data = createUnitSchema.parse(request.body);

      try {
        const unit = await controller.createUnit(contextFrom(request), buildingId, data as any);
        return reply.status(201).send(unit);
      } catch (error) {
        if (error instanceof BuildingNotFoundError) {
          return reply.status(404).send({ message: error.message });
        }
        throw error;
      }
    }
  );

  app.get<{ Params: { buildingId: string } }>('/buildings/:buildingId/units', async (request, reply) => {
    const { buildingId } = request.params;

    try {
      const units = await controller.listUnits(contextFrom(request), buildingId);
      return reply.status(200).send(units);
    } catch (error) {
      if (error instanceof BuildingNotFoundError) {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });

  app.delete<{ Params: { buildingId: string; unitId: string } }>('/buildings/:buildingId/units/:unitId', async (request, reply) => {
    const { buildingId, unitId } = request.params;
    try {
      await controller.deleteUnit(contextFrom(request), buildingId, unitId);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof BuildingNotFoundError) {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });
}
