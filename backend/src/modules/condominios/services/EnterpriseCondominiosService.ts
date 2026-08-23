import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrismaClient } from '../../../database/prisma/client';

export class BuildingNotFoundError extends Error {
  constructor() {
    super('Condomínio não encontrado.');
  }
}

/**
 * CRUD mínimo do módulo de Gestão de Condomínios — Building (o condomínio)
 * e Unit (a fração), o suficiente para provar que o modelo de dados
 * funciona na prática (ver README, secção "Gestão de Condomínios") antes de
 * construir o resto (Owner, Fee, Assembly, Vote, Expense) e a UI completa.
 *
 * Isolamento multi-tenant: Building tem tenantId direto, por isso já está
 * coberto pela Prisma Client Extension (tenantScopedClient.ts) tal como
 * Lead/Opportunity/Customer. Unit NÃO tem tenantId direto (só buildingId) —
 * a extensão não o protege sozinha, por isso `requireOwnedBuilding()`
 * confirma sempre, antes de qualquer leitura/escrita em Unit, que o
 * Building pai pertence a este tenant. Mesmo padrão que já usávamos para
 * Contact via Customer no módulo de CRM.
 */
export class EnterpriseCondominiosService {
  constructor(
    private readonly tenantId: string,
    private readonly db: PrismaClient = defaultPrismaClient
  ) {}

  public async createBuilding(data: {
    name: string;
    address: string;
    municipality: string;
    taxNumber?: string;
    totalPermille?: number;
  }) {
    return this.db.building.create({
      data: {
        tenantId: this.tenantId,
        name: data.name,
        address: data.address,
        municipality: data.municipality,
        taxNumber: data.taxNumber || null,
        totalPermille: data.totalPermille ?? 1000
      }
    });
  }

  public async listBuildings() {
    return this.db.building.findMany({ where: { tenantId: this.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  private async requireOwnedBuilding(buildingId: string) {
    const building = await this.db.building.findUnique({
      where: { id: buildingId, tenantId: this.tenantId } as any
    });
    if (!building) {
      throw new BuildingNotFoundError();
    }
    return building;
  }

  public async createUnit(buildingId: string, data: { identifier: string; permille: number }) {
    await this.requireOwnedBuilding(buildingId);
    return this.db.unit.create({
      data: {
        buildingId,
        identifier: data.identifier,
        permille: data.permille
      }
    });
  }

  public async listUnits(buildingId: string) {
    await this.requireOwnedBuilding(buildingId);
    return this.db.unit.findMany({ where: { buildingId }, orderBy: { identifier: 'asc' } });
  }
}
