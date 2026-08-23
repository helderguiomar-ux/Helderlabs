import type { PrismaClient } from '@prisma/client';
import { EnterpriseCondominiosService } from '../services/EnterpriseCondominiosService';

// O contexto é sempre derivado de request.user/request.db (preenchidos pelo
// hook app.authenticate) — nunca de query/body. Ver condominios.routes.ts.
export interface CondominiosRequestContext {
  tenantId: string;
  db: PrismaClient;
}

function serviceFor(context: CondominiosRequestContext) {
  return new EnterpriseCondominiosService(context.tenantId, context.db);
}

export class CondominiosController {
  async createBuilding(
    context: CondominiosRequestContext,
    data: { name: string; address: string; municipality: string; taxNumber?: string; totalPermille?: number }
  ) {
    return serviceFor(context).createBuilding(data);
  }

  async listBuildings(context: CondominiosRequestContext) {
    return serviceFor(context).listBuildings();
  }

  async createUnit(context: CondominiosRequestContext, buildingId: string, data: { identifier: string; permille: number }) {
    return serviceFor(context).createUnit(buildingId, data);
  }

  async listUnits(context: CondominiosRequestContext, buildingId: string) {
    return serviceFor(context).listUnits(buildingId);
  }
}
