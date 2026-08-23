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

  async updateBuilding(context: CondominiosRequestContext, buildingId: string, data: any) {
    return serviceFor(context).updateBuilding(buildingId, data);
  }

  async deleteBuilding(context: CondominiosRequestContext, buildingId: string) {
    return serviceFor(context).deleteBuilding(buildingId);
  }

  async createUnit(context: CondominiosRequestContext, buildingId: string, data: { identifier: string; permille: number }) {
    return serviceFor(context).createUnit(buildingId, data);
  }

  async listUnits(context: CondominiosRequestContext, buildingId: string) {
    return serviceFor(context).listUnits(buildingId);
  }

  async deleteUnit(context: CondominiosRequestContext, buildingId: string, unitId: string) {
    return serviceFor(context).deleteUnit(buildingId, unitId);
  }
}
