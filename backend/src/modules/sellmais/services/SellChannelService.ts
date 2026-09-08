export class SellChannelService {
  static async listChannels(db: any, tenantId: string) {
    await this.ensureDefaults(db, tenantId);
    return db.sellChannel.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' }
    });
  }

  static async listListings(db: any, tenantId: string, itemId?: string) {
    const where: any = { tenantId };
    if (itemId) where.itemId = itemId;
    return db.sellChannelListing.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
  }

  static async createOrUpdateListing(
    db: any,
    tenantId: string,
    data: {
      itemId: string;
      channelId: string;
      externalId?: string;
      listingUrl?: string;
      status?: string;
    }
  ) {
    return db.sellChannelListing.upsert({
      where: {
        tenantId_itemId_channelId: {
          tenantId,
          itemId: data.itemId,
          channelId: data.channelId
        }
      },
      update: {
        externalId: data.externalId,
        listingUrl: data.listingUrl,
        status: data.status || 'PUBLISHED',
        lastSyncAt: new Date()
      },
      create: {
        tenantId,
        itemId: data.itemId,
        channelId: data.channelId,
        externalId: data.externalId || null,
        listingUrl: data.listingUrl || null,
        status: data.status || 'PUBLISHED',
        lastSyncAt: new Date()
      }
    });
  }

  static async listPendingJobs(db: any, tenantId: string) {
    return db.sellChannelJob.findMany({
      where: { tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50
    });
  }

  static async processPendingJobs(db: any, tenantId: string) {
    const jobs = await db.sellChannelJob.findMany({
      where: { tenantId, status: 'PENDING' },
      take: 20
    });

    const processed: any[] = [];
    for (const job of jobs) {
      // In production with real APIs, calls the channel adapter
      // Here in core outbox, marks as COMPLETED and updates listing status
      await db.sellChannelJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          attempts: job.attempts + 1
        }
      });

      if (job.action === 'UNPUBLISH') {
        await db.sellChannelListing.updateMany({
          where: { tenantId, itemId: job.itemId, channelId: job.channelId },
          data: { status: 'UNPUBLISHED', lastSyncAt: new Date() }
        });
      }

      processed.push({ id: job.id, action: job.action, status: 'COMPLETED' });
    }

    return { processedCount: processed.length, jobs: processed };
  }

  static async ensureDefaults(db: any, tenantId: string) {
    const count = await db.sellChannel.count({ where: { tenantId } });
    if (count > 0) return;

    const defaults = [
      { key: 'website', name: 'Catálogo Online & Loja Web', manualOnly: false },
      { key: 'olx', name: 'OLX Portugal', manualOnly: true },
      { key: 'standvirtual', name: 'Standvirtual', manualOnly: true },
      { key: '1stdibs', name: '1stdibs Internacional', manualOnly: true },
      { key: 'ebay', name: 'eBay Antiques', manualOnly: true }
    ];

    for (const d of defaults) {
      await db.sellChannel.create({
        data: {
          tenantId,
          key: d.key,
          name: d.name,
          manualOnly: d.manualOnly,
          active: true
        }
      }).catch(() => {});
    }
  }
}
