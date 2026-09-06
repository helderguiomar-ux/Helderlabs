import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RecurrenceService } from '../../src/modules/financas/services/RecurrenceService';

describe('RecurrenceService Unit Tests', () => {
  test('calculateOccurrenceDates handles Feb 31 in short months (clamping to Feb 28 in non-leap year)', () => {
    const rule = {
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 31,
      startDate: new Date(Date.UTC(2025, 0, 31)), // Jan 31, 2025
      endDate: new Date(Date.UTC(2025, 2, 31))     // Mar 31, 2025
    };

    const targetDate = new Date(Date.UTC(2025, 3, 1));
    const dates = RecurrenceService.calculateOccurrenceDates(rule, targetDate);

    assert.strictEqual(dates.length, 3);
    assert.strictEqual(dates[0].toISOString().substring(0, 10), '2025-01-31');
    assert.strictEqual(dates[1].toISOString().substring(0, 10), '2025-02-28'); // Feb 28 non-leap year!
    assert.strictEqual(dates[2].toISOString().substring(0, 10), '2025-03-31'); // Back to 31 in March!
  });

  test('calculateOccurrenceDates handles Feb 29 in leap year 2028', () => {
    const rule = {
      frequency: 'MONTHLY',
      interval: 1,
      dayOfMonth: 31,
      startDate: new Date(Date.UTC(2028, 0, 31)), // Jan 31, 2028
      endDate: new Date(Date.UTC(2028, 2, 31))
    };

    const targetDate = new Date(Date.UTC(2028, 3, 1));
    const dates = RecurrenceService.calculateOccurrenceDates(rule, targetDate);

    assert.strictEqual(dates.length, 3);
    assert.strictEqual(dates[1].toISOString().substring(0, 10), '2028-02-29'); // Feb 29 leap year!
  });

  test('calculateOccurrenceDates weekly frequency calculates correct intervals', () => {
    const rule = {
      frequency: 'WEEKLY',
      interval: 2, // Every 2 weeks
      startDate: new Date(Date.UTC(2026, 8, 1))
    };

    const targetDate = new Date(Date.UTC(2026, 8, 30));
    const dates = RecurrenceService.calculateOccurrenceDates(rule, targetDate);

    assert.strictEqual(dates.length, 3);
    assert.strictEqual(dates[0].toISOString().substring(0, 10), '2026-09-01');
    assert.strictEqual(dates[1].toISOString().substring(0, 10), '2026-09-15');
    assert.strictEqual(dates[2].toISOString().substring(0, 10), '2026-09-29');
  });

  test('materialize is idempotent and does not duplicate existing transactions', async () => {
    const createdTransactions: any[] = [];
    const rule = {
      id: 'rule_1',
      tenantId: 'tenant_1',
      description: 'Seguro Mensal',
      amountCents: 5000,
      categoryId: 'cat_1',
      kind: 'EXPENSE',
      freq: 'MONTHLY',
      interval: 1,
      dayOfMonth: 5,
      startDate: new Date(Date.UTC(2026, 8, 5)),
      endDate: null,
      active: true
    };

    const mockDb = {
      recurringRule: {
        findMany: async () => [rule],
        update: async () => {}
      },
      financeTransaction: {
        findFirst: async ({ where }: any) => {
          return createdTransactions.find(
            t => t.recurringRuleId === where.recurringRuleId && t.dueDate.getTime() === where.dueDate.getTime()
          ) || null;
        },
        create: async ({ data }: any) => {
          const newTx = { id: `tx_${createdTransactions.length + 1}`, ...data };
          createdTransactions.push(newTx);
          return newTx;
        },
        update: async () => {}
      }
    };

    // First materialization run
    const result1 = await RecurrenceService.materialize('tenant_1', new Date(Date.UTC(2026, 8, 10)), mockDb);
    assert.strictEqual(result1.materializedCount, 1);
    assert.strictEqual(createdTransactions.length, 1);

    // Second materialization run for exact same target date -> 0 new transactions created!
    const result2 = await RecurrenceService.materialize('tenant_1', new Date(Date.UTC(2026, 8, 10)), mockDb);
    assert.strictEqual(result2.materializedCount, 0);
    assert.strictEqual(createdTransactions.length, 1);
  });
});
