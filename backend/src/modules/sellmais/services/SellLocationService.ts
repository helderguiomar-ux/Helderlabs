export class SellLocationService {
  static async listLocations(db: any, tenantId: string) {
    return db.sellLocation.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { path: 'asc' }
    });
  }

  static async createLocation(db: any, tenantId: string, data: {
    name: string;
    parentId?: string;
  }) {
    let parentPath = '';
    if (data.parentId) {
      const parent = await db.sellLocation.findUnique({ where: { id: data.parentId } });
      if (parent) parentPath = `${parent.path} > `;
    }

    const path = `${parentPath}${data.name.trim()}`;

    return db.sellLocation.create({
      data: {
        tenantId,
        parentId: data.parentId || null,
        name: data.name.trim(),
        path
      }
    });
  }

  static async deleteLocation(db: any, tenantId: string, id: string) {
    return db.sellLocation.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }
}
