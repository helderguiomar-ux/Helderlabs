export class SellConsignmentService {
  static async createConsignment(
    db: any,
    tenantId: string,
    data: {
      consignorCompanyId: string;
      reference: string;
      startedAt?: string | Date;
      endsAt?: string | Date;
      commissionPercent?: number; // e.g. 3000 = 30.00%
      commissionFixedCents?: number;
      minPriceCents?: number;
      settlementNotes?: string;
    }
  ) {
    return db.sellConsignment.create({
      data: {
        tenantId,
        consignorCompanyId: data.consignorCompanyId,
        reference: data.reference.trim(),
        startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        commissionPercent: data.commissionPercent ?? 3000,
        commissionFixedCents: data.commissionFixedCents ? Math.round(data.commissionFixedCents) : null,
        minPriceCents: data.minPriceCents ? Math.round(data.minPriceCents) : null,
        status: 'ACTIVE',
        settlementNotes: data.settlementNotes || null
      }
    });
  }

  static async listConsignments(db: any, tenantId: string) {
    return db.sellConsignment.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        items: true
      },
      orderBy: { startedAt: 'desc' }
    });
  }

  static async linkItemToConsignment(
    db: any,
    tenantId: string,
    consignmentId: string,
    itemId: string,
    agreedPriceCents?: number
  ) {
    const consignment = await db.sellConsignment.findUnique({ where: { id: consignmentId } });
    if (!consignment || consignment.tenantId !== tenantId) throw new Error('Consignação não encontrada.');

    // Update item acquisition type
    await db.sellItem.update({
      where: { id: itemId },
      data: {
        acquisitionType: 'CONSIGNMENT',
        supplierCompanyId: consignment.consignorCompanyId,
        minPriceCents: consignment.minPriceCents
      }
    });

    return db.sellConsignmentItem.create({
      data: {
        tenantId,
        consignmentId,
        itemId,
        agreedPriceCents: agreedPriceCents ? Math.round(agreedPriceCents) : null
      }
    });
  }

  /**
   * Settles commission and payout for a sold consignment item.
   */
  static async settleItem(
    db: any,
    tenantId: string,
    itemId: string,
    soldPriceCents: number
  ) {
    const cItem = await db.sellConsignmentItem.findUnique({
      where: { itemId },
      include: { consignment: true }
    });

    if (!cItem || cItem.tenantId !== tenantId) return null;

    const consignment = cItem.consignment;
    let commissionCents = 0;

    if (consignment.commissionPercent) {
      commissionCents += Math.round((soldPriceCents * consignment.commissionPercent) / 10000);
    }
    if (consignment.commissionFixedCents) {
      commissionCents += consignment.commissionFixedCents;
    }

    const payoutCents = Math.max(0, soldPriceCents - commissionCents);

    return db.sellConsignmentItem.update({
      where: { id: cItem.id },
      data: {
        soldPriceCents,
        commissionCents,
        payoutCents,
        settledAt: new Date()
      }
    });
  }
}
