import { SellItemStatus } from '@prisma/client';
import crypto from 'node:crypto';

export class SellItemStateService {
  private static readonly VALID_TRANSITIONS: Record<SellItemStatus, SellItemStatus[]> = {
    DRAFT: [SellItemStatus.AVAILABLE, SellItemStatus.UNAVAILABLE, SellItemStatus.WRITTEN_OFF],
    AVAILABLE: [SellItemStatus.RESERVED, SellItemStatus.IN_RESTORATION, SellItemStatus.IN_AUCTION, SellItemStatus.SOLD, SellItemStatus.RETURNED, SellItemStatus.UNAVAILABLE, SellItemStatus.WRITTEN_OFF],
    RESERVED: [SellItemStatus.AVAILABLE, SellItemStatus.SOLD, SellItemStatus.UNAVAILABLE, SellItemStatus.RETURNED],
    IN_RESTORATION: [SellItemStatus.AVAILABLE, SellItemStatus.UNAVAILABLE, SellItemStatus.WRITTEN_OFF],
    IN_AUCTION: [SellItemStatus.AVAILABLE, SellItemStatus.SOLD, SellItemStatus.UNAVAILABLE],
    SOLD: [SellItemStatus.RETURNED], // Excepcional devolução
    RETURNED: [SellItemStatus.AVAILABLE, SellItemStatus.DRAFT],
    UNAVAILABLE: [SellItemStatus.AVAILABLE, SellItemStatus.DRAFT],
    WRITTEN_OFF: []
  };

  /**
   * Executes an atomic state transition with validation, events and channel unpublish outbox jobs.
   */
  static async transitionState(
    db: any,
    tenantId: string,
    userId: string,
    itemId: string,
    targetState: SellItemStatus,
    options: {
      soldPriceCents?: number;
      buyerCompanyId?: string;
      reason?: string;
    } = {}
  ) {
    const item = await db.sellItem.findUnique({ where: { id: itemId } });
    if (!item || item.tenantId !== tenantId) throw new Error('Artigo não encontrado.');

    const currentState = item.status as SellItemStatus;
    if (currentState === targetState) {
      return item; // No-op
    }

    const allowed = this.VALID_TRANSITIONS[currentState] || [];
    if (!allowed.includes(targetState)) {
      throw new Error(`Transição de estado inválida: de ${currentState} para ${targetState}.`);
    }

    // Validation rules per target state
    const updateData: any = { status: targetState };

    if (targetState === SellItemStatus.AVAILABLE) {
      if (!item.askingPriceCents) {
        throw new Error('Não é possível disponibilizar um artigo sem preço de venda definido.');
      }
      if (!item.availableSince) {
        updateData.availableSince = new Date();
      }
      if (!item.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    if (targetState === SellItemStatus.SOLD) {
      if (options.soldPriceCents !== undefined) {
        updateData.soldPriceCents = Math.round(options.soldPriceCents);
      } else if (!item.soldPriceCents) {
        updateData.soldPriceCents = item.askingPriceCents;
      }
      if (options.buyerCompanyId) {
        updateData.buyerCompanyId = options.buyerCompanyId;
      }
      updateData.soldAt = new Date();
    }

    // 1. Update item
    const updated = await db.sellItem.update({
      where: { id: itemId },
      data: updateData
    });

    // 2. Record Event Timeline
    await db.sellItemEvent.create({
      data: {
        tenantId,
        itemId,
        eventType: 'STATUS_CHANGE',
        fromState: currentState,
        toState: targetState,
        description: options.reason || `Estado alterado de ${currentState} para ${targetState}`,
        actorUserId: userId
      }
    });

    // 3. Outbox Pattern: If item is no longer available, schedule UNPUBLISH for all active channel listings
    const terminalOrUnavailable: SellItemStatus[] = [
      SellItemStatus.SOLD,
      SellItemStatus.RESERVED,
      SellItemStatus.UNAVAILABLE,
      SellItemStatus.RETURNED,
      SellItemStatus.WRITTEN_OFF
    ];

    if (terminalOrUnavailable.includes(targetState)) {
      const activeListings = await db.sellChannelListing.findMany({
        where: { tenantId, itemId, status: 'PUBLISHED' }
      });

      for (const listing of activeListings) {
        const idempotencyKey = `unpublish-${itemId}-${listing.channelId}-${Date.now()}`;
        await db.sellChannelJob.create({
          data: {
            tenantId,
            idempotencyKey,
            itemId,
            channelId: listing.channelId,
            action: 'UNPUBLISH',
            status: 'PENDING',
            payload: { reason: `Item mudou de estado para ${targetState}` }
          }
        }).catch(() => {});
      }
    }

    return updated;
  }
}
