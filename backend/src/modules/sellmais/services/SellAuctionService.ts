import { SellCounterService } from './SellCounterService';
import { prisma } from '../../../database/prisma/client';

export class SellAuctionService {
  static async createAuction(
    db: any,
    tenantId: string,
    data: {
      title: string;
      startsAt: string | Date;
      endsAt: string | Date;
      terms?: string;
    }
  ) {
    const code = await SellCounterService.getNextCode(db, tenantId, 'auction');
    return db.sellAuction.create({
      data: {
        tenantId,
        title: data.title.trim(),
        code,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        status: 'SCHEDULED',
        terms: data.terms || null
      }
    });
  }

  static async addLot(
    db: any,
    tenantId: string,
    auctionId: string,
    data: {
      itemId: string;
      lotNumber: number;
      startingBidCents: number;
      reservePriceCents?: number;
      minIncrementCents?: number;
    }
  ) {
    // Update item status to IN_AUCTION
    await db.sellItem.update({
      where: { id: data.itemId },
      data: { status: 'IN_AUCTION' }
    });

    return db.sellAuctionLot.create({
      data: {
        tenantId,
        auctionId,
        itemId: data.itemId,
        lotNumber: data.lotNumber,
        startingBidCents: Math.round(data.startingBidCents),
        reservePriceCents: data.reservePriceCents ? Math.round(data.reservePriceCents) : null,
        minIncrementCents: data.minIncrementCents ? Math.round(data.minIncrementCents) : 500,
        currentBidCents: 0,
        status: 'PENDING'
      }
    });
  }

  /**
   * Places a bid with strict concurrency locking and anti-sniping extension.
   */
  static async placeBid(
    db: any,
    tenantId: string,
    lotId: string,
    bidderId: string,
    amountCents: number
  ) {
    const amount = Math.round(amountCents);

    // Run inside an isolated transaction
    return prisma.$transaction(async (tx) => {
      const lot = await tx.sellAuctionLot.findUnique({
        where: { id: lotId },
        include: { auction: true }
      });

      if (!lot || lot.tenantId !== tenantId) {
        throw new Error('Lote de leilão não encontrado.');
      }

      const auction = lot.auction;
      const now = new Date();

      if (auction.status !== 'ACTIVE' && auction.status !== 'SCHEDULED') {
        throw new Error('O leilão não se encontra ativo.');
      }

      const minAllowed = lot.currentBidCents === 0
        ? lot.startingBidCents
        : lot.currentBidCents + lot.minIncrementCents;

      if (amount < minAllowed) {
        throw new Error(`Licitação inválida: o valor mínimo aceite é ${(minAllowed / 100).toFixed(2)} €.`);
      }

      // Mark previous winning bids as OUTBID
      await tx.sellBid.updateMany({
        where: { lotId, status: 'VALID' },
        data: { status: 'OUTBID' }
      });

      // Create new Bid
      const newBid = await tx.sellBid.create({
        data: {
          tenantId,
          lotId,
          bidderId,
          amountCents: amount,
          status: 'VALID'
        }
      });

      // Update Lot current bid and winning bid
      await tx.sellAuctionLot.update({
        where: { id: lotId },
        data: {
          currentBidCents: amount,
          winningBidId: newBid.id,
          status: 'ACTIVE'
        }
      });

      // Anti-sniping rule: if bid placed in last 2 minutes, extend by 5 minutes
      const timeRemainingMs = new Date(auction.endsAt).getTime() - now.getTime();
      if (timeRemainingMs > 0 && timeRemainingMs < 2 * 60 * 1000) {
        const extendedEndsAt = new Date(new Date(auction.endsAt).getTime() + 5 * 60 * 1000);
        await tx.sellAuction.update({
          where: { id: auction.id },
          data: { endsAt: extendedEndsAt }
        });
      }

      return {
        success: true,
        bid: newBid,
        lot: {
          id: lot.id,
          auctionId: lot.auctionId,
          itemId: lot.itemId,
          currentBidCents: amount,
          winningBidId: newBid.id
        },
        currentBidCents: amount
      };
    });
  }

  static async listAuctions(db: any, tenantId: string) {
    return db.sellAuction.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        lots: {
          include: {
            item: {
              select: {
                id: true,
                code: true,
                title: true,
                status: true
              }
            }
          }
        }
      },
      orderBy: { startsAt: 'desc' }
    });
  }

  /**
   * Closes all expired auctions atomically and settles winning lots.
   * Invoked idempotently by Vercel Cron or background worker.
   */
  static async closePendingAuctions(tenantId?: string): Promise<{ closedAuctionsCount: number; settledLotsCount: number }> {
    const now = new Date();
    const where: any = {
      endsAt: { lte: now },
      status: { in: ['ACTIVE', 'SCHEDULED'] }
    };
    if (tenantId) where.tenantId = tenantId;

    const expiredAuctions = await prisma.sellAuction.findMany({
      where,
      include: {
        lots: true
      }
    });

    let closedAuctionsCount = 0;
    let settledLotsCount = 0;

    for (const auction of expiredAuctions) {
      await prisma.$transaction(async (tx) => {
        for (const lot of auction.lots) {
          const meetsReserve = lot.currentBidCents > 0 &&
            (!lot.reservePriceCents || lot.currentBidCents >= lot.reservePriceCents);

          if (meetsReserve && lot.winningBidId) {
            await tx.sellAuctionLot.update({
              where: { id: lot.id },
              data: { status: 'SOLD' }
            });
            await tx.sellItem.update({
              where: { id: lot.itemId },
              data: {
                status: 'SOLD',
                soldPriceCents: lot.currentBidCents,
                soldAt: now
              }
            });
            settledLotsCount++;
          } else {
            await tx.sellAuctionLot.update({
              where: { id: lot.id },
              data: { status: 'UNSOLD' }
            });
            await tx.sellItem.update({
              where: { id: lot.itemId },
              data: { status: 'AVAILABLE' }
            });
          }
        }

        await tx.sellAuction.update({
          where: { id: auction.id },
          data: { status: 'CLOSED' }
        });
        closedAuctionsCount++;
      });
    }

    return { closedAuctionsCount, settledLotsCount };
  }
}

