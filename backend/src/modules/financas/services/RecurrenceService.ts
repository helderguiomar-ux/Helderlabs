import { prisma as defaultPrismaClient } from '../../../database/prisma/client';

export class RecurrenceService {
  /**
   * Generates occurrence dates for a recurring rule up to targetDate.
   * Properly handles short months (e.g. Feb 31 -> Feb 28/29).
   */
  public static calculateOccurrenceDates(
    rule: {
      freq: string;
      interval: number;
      dayOfMonth?: number | null;
      startDate: Date;
      endDate?: Date | null;
    },
    targetDate: Date
  ): Date[] {
    const dates: Date[] = [];
    let current = new Date(rule.startDate);
    current.setUTCHours(0, 0, 0, 0);

    const maxTarget = new Date(targetDate);
    maxTarget.setUTCHours(23, 59, 59, 999);

    const endCutoff = rule.endDate ? new Date(rule.endDate) : null;
    if (endCutoff) endCutoff.setUTCHours(23, 59, 59, 999);

    const desiredDay = rule.dayOfMonth || current.getUTCDate();
    let stepCount = 0;
    const maxSteps = 1000; // safety ceiling

    while (current <= maxTarget && stepCount < maxSteps) {
      if (endCutoff && current > endCutoff) break;

      dates.push(new Date(current));
      stepCount++;

      const freqRaw = rule.freq || (rule as any).frequency || 'MONTHLY';
      const freq = freqRaw.toUpperCase();
      const interval = Math.max(1, rule.interval || 1);

      if (freq === 'WEEKLY') {
        current.setUTCDate(current.getUTCDate() + (interval * 7));
      } else if (freq === 'MONTHLY' || freq === 'QUARTERLY') {
        const monthsToAdd = freq === 'QUARTERLY' ? interval * 3 : interval;
        const currentYear = current.getUTCFullYear();
        const currentMonth = current.getUTCMonth();
        
        const targetMonth = currentMonth + monthsToAdd;
        const targetYear = currentYear + Math.floor(targetMonth / 12);
        const normalizedMonth = ((targetMonth % 12) + 12) % 12;

        const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
        const actualDay = Math.min(desiredDay, daysInTargetMonth);

        current = new Date(Date.UTC(targetYear, normalizedMonth, actualDay));
      } else if (freq === 'YEARLY') {
        const targetYear = current.getUTCFullYear() + interval;
        const targetMonth = current.getUTCMonth();
        const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        const actualDay = Math.min(desiredDay, daysInTargetMonth);

        current = new Date(Date.UTC(targetYear, targetMonth, actualDay));
      } else {
        break;
      }
    }

    return dates;
  }

  /**
   * Materializes recurring transactions for a tenant up to targetDate.
   * Guarantees idempotency and preserves paid/overridden transactions.
   */
  public static async materialize(
    tenantId: string,
    targetDate: Date = new Date(),
    db: any = defaultPrismaClient
  ): Promise<{ materializedCount: number }> {
    const rules = await db.recurringRule.findMany({
      where: { tenantId, active: true }
    });

    let count = 0;

    for (const rule of rules) {
      const occurrenceDates = this.calculateOccurrenceDates(rule, targetDate);

      for (const occDate of occurrenceDates) {
        // Check if transaction already exists for this rule and dueDate
        const existing = await db.financeTransaction.findFirst({
          where: {
            tenantId,
            recurringRuleId: rule.id,
            dueDate: occDate
          }
        });

        if (existing) {
          // Preserve paid or explicitly overridden transactions
          if (existing.status === 'PAID' || existing.overriddenAt !== null) {
            continue;
          }
          // If un-paid and not overridden, update with latest rule values if changed
          if (existing.amountCents !== rule.amountCents || existing.description !== rule.description) {
            await db.financeTransaction.update({
              where: { id: existing.id },
              data: {
                amountCents: rule.amountCents,
                description: rule.description,
                categoryId: rule.categoryId
              }
            });
          }
          continue;
        }

        await db.financeTransaction.create({
          data: {
            tenantId,
            kind: rule.kind,
            description: rule.description,
            amountCents: rule.amountCents,
            categoryId: rule.categoryId,
            dueDate: occDate,
            status: 'PLANNED',
            recurringRuleId: rule.id
          }
        });

        count++;
      }

      await db.recurringRule.update({
        where: { id: rule.id },
        data: { lastGeneratedUntil: targetDate }
      });
    }

    return { materializedCount: count };
  }
}
