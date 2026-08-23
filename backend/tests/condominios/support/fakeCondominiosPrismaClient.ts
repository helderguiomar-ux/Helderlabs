// Prisma "fake" em memória — mesmo princípio de tests/crm/support/fakePrismaClient.ts,
// mas só com o subconjunto (building, unit) que o EnterpriseCondominiosService usa.

let counter = 0;
function fakeId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function createFakeCondominiosPrismaClient() {
  const buildings: any[] = [];
  const units: any[] = [];

  const db = {
    __seed: { buildings, units },

    building: {
      create: async ({ data }: any) => {
        const building = { id: fakeId('building'), createdAt: new Date(), ...data };
        buildings.push(building);
        return building;
      },
      findUnique: async ({ where }: any) =>
        buildings.find((b) => b.id === where.id && (!where.tenantId || b.tenantId === where.tenantId)) ?? null,
      findMany: async ({ where }: any = {}) =>
        buildings.filter((b) => !where?.tenantId || b.tenantId === where.tenantId)
    },

    unit: {
      create: async ({ data }: any) => {
        const unit = { id: fakeId('unit'), createdAt: new Date(), ...data };
        units.push(unit);
        return unit;
      },
      findMany: async ({ where }: any = {}) => units.filter((u) => !where?.buildingId || u.buildingId === where.buildingId)
    }
  };

  return db;
}
