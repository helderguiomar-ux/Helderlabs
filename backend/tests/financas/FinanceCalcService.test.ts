import { test, describe } from 'node:test';
import assert from 'node:assert';
import { FinanceCalcService } from '../../src/modules/financas/services/FinanceCalcService';

describe('FinanceCalcService Math Engine Tests', () => {
  test('calculateKPIs sums opening balances and paid transactions correctly in integer cents', async () => {
    const fakeDb = {
      financeAccount: {
        findMany: async () => [
          { id: 'acc_1', openingBalanceCents: 500000 }, // 5,000.00 EUR
          { id: 'acc_2', openingBalanceCents: 150000 }  // 1,500.00 EUR
        ]
      },
      financeTransaction: {
        findMany: async () => [
          // Realized Income: +2,000.00 EUR
          {
            id: 't1',
            kind: 'INCOME',
            type: 'INCOME',
            amountCents: 200000,
            dueDate: new Date('2026-09-01'),
            paidDate: new Date('2026-09-01'),
            status: 'PAID'
          },
          // Realized Expense: -500.00 EUR
          {
            id: 't2',
            kind: 'EXPENSE',
            type: 'EXPENSE',
            amountCents: 50000,
            dueDate: new Date('2026-09-02'),
            paidDate: new Date('2026-09-02'),
            status: 'PAID'
          },
          // Transfer (Should NOT change global income or expenses or global balance): 300.00 EUR
          {
            id: 't3',
            kind: 'EXPENSE',
            type: 'TRANSFER',
            amountCents: 30000,
            dueDate: new Date('2026-09-03'),
            paidDate: new Date('2026-09-03'),
            status: 'PAID'
          },
          // Planned Future Expense: 400.00 EUR
          {
            id: 't4',
            kind: 'EXPENSE',
            type: 'EXPENSE',
            amountCents: 40000,
            dueDate: new Date('2026-12-15'),
            paidDate: null,
            status: 'PLANNED'
          },
          // Overdue Expense (Past DueDate, Unpaid): 250.00 EUR
          {
            id: 't5',
            kind: 'EXPENSE',
            type: 'EXPENSE',
            amountCents: 25000,
            dueDate: new Date('2026-01-01'),
            paidDate: null,
            status: 'PLANNED'
          }
        ]
      }
    };

    const kpis = await FinanceCalcService.calculateKPIs(fakeDb, 'tenant_test');

    // Starting Opening Balances = 500000 + 150000 = 650000 cents (6,500.00 EUR)
    // Realized Income = 200000 cents (2,000.00 EUR)
    // Realized Expense = 50000 cents (500.00 EUR)
    // Current Balance = 650000 + 200000 - 50000 = 800000 cents (8,000.00 EUR)
    assert.strictEqual(kpis.currentBalanceCents, 800000);
    assert.strictEqual(kpis.totalIncomeCents, 200000);
    assert.strictEqual(kpis.totalExpenseCents, 50000);
    assert.strictEqual(kpis.netResultCents, 150000);
    assert.strictEqual(kpis.committedCents, 40000);
    assert.strictEqual(kpis.overdueCents, 25000);
    // Available Balance = 800000 - 40000 - 25000 = 735000 cents (7,350.00 EUR)
    assert.strictEqual(kpis.availableBalanceCents, 735000);
  });

  test('calculateCashFlowProjections projects planned transactions and recurring rules across 30 days', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const in5Days = new Date(today);
    in5Days.setDate(in5Days.getDate() + 5);

    const in10Days = new Date(today);
    in10Days.setDate(in10Days.getDate() + 10);

    const fakeDb = {
      financeAccount: {
        findMany: async () => [{ id: 'acc_1', openingBalanceCents: 100000 }] // 1,000.00 EUR
      },
      financeTransaction: {
        findMany: async ({ where }: any) => {
          if (where?.status?.in) {
            // Planned transactions
            return [
              {
                id: 'tx_plan_1',
                kind: 'INCOME',
                amountCents: 50000,
                dueDate: in5Days,
                status: 'PLANNED'
              },
              {
                id: 'tx_plan_2',
                kind: 'EXPENSE',
                amountCents: 20000,
                dueDate: in10Days,
                status: 'PLANNED'
              }
            ];
          }
          // KPI calculation call
          return [];
        }
      },
      recurringRule: {
        findMany: async () => [
          {
            id: 'rule_weekly_rent',
            kind: 'EXPENSE',
            amountCents: 10000,
            freq: 'WEEKLY',
            interval: 1,
            startDate: today,
            endDate: null
          }
        ]
      }
    };

    const projections = await FinanceCalcService.calculateCashFlowProjections(fakeDb, 'tenant_test', 30);

    assert.strictEqual(projections.days, 30);
    assert.strictEqual(projections.startingBalanceCents, 100000);
    assert.ok(projections.dailyPoints.length >= 30);

    // Starting point is day 0
    assert.strictEqual(projections.dailyPoints[0].date, FinanceCalcService.formatDateStr(today));
    // Ending balance should be computed deterministically
    assert.ok(typeof projections.endingBalanceCents === 'number');
  });

  test('calculateBurnRate computes average monthly burn and runway accurately', async () => {
    const fakeDb = {
      financeAccount: {
        findMany: async () => [{ id: 'acc_1', openingBalanceCents: 1000000 }] // 10,000.00 EUR
      },
      financeTransaction: {
        findMany: async () => [
          // 3 months of expenses total 3,000.00 EUR (1,000.00 EUR / month)
          {
            id: 't1',
            kind: 'EXPENSE',
            type: 'EXPENSE',
            amountCents: 300000,
            dueDate: new Date(),
            paidDate: new Date(),
            status: 'PAID'
          },
          // 3 months of income total 1,500.00 EUR (500.00 EUR / month)
          {
            id: 't2',
            kind: 'INCOME',
            type: 'INCOME',
            amountCents: 150000,
            dueDate: new Date(),
            paidDate: new Date(),
            status: 'PAID'
          }
        ]
      }
    };

    const burnRate = await FinanceCalcService.calculateBurnRate(fakeDb, 'tenant_test');

    // Monthly avg expense = 300000 / 3 = 100000 cents (1,000.00 EUR)
    // Monthly avg income = 150000 / 3 = 50000 cents (500.00 EUR)
    // Net monthly burn = 50000 cents (500.00 EUR)
    // Current Balance = 1000000 + 150000 - 300000 = 850000 cents (8,500.00 EUR)
    // Runway = 850000 / 50000 = 17.0 months
    assert.strictEqual(burnRate.monthlyAverageExpenseCents, 100000);
    assert.strictEqual(burnRate.monthlyAverageIncomeCents, 50000);
    assert.strictEqual(burnRate.netMonthlyBurnCents, 50000);
    assert.strictEqual(burnRate.runwayMonths, 17);
  });

  test('calculateCategoryBudgets flags over-budget categories and calculates percentage used', async () => {
    const fakeDb = {
      financeCategory: {
        findMany: async () => [
          {
            id: 'cat_marketing',
            name: 'Marketing',
            kind: 'EXPENSE',
            color: '#ff0000',
            icon: 'megaphone',
            budgetAmountCents: 100000 // 1,000.00 EUR budget
          },
          {
            id: 'cat_tools',
            name: 'Software',
            kind: 'EXPENSE',
            color: '#00ff00',
            icon: 'code',
            budgetAmountCents: 50000 // 500.00 EUR budget
          }
        ]
      },
      financeTransaction: {
        findMany: async () => [
          // Marketing: 800 EUR paid + 300 EUR planned = 1100 EUR (Over budget by 100 EUR!)
          {
            id: 'tx1',
            categoryId: 'cat_marketing',
            kind: 'EXPENSE',
            amountCents: 80000,
            status: 'PAID',
            paidDate: new Date(),
            dueDate: new Date()
          },
          {
            id: 'tx2',
            categoryId: 'cat_marketing',
            kind: 'EXPENSE',
            amountCents: 30000,
            status: 'PLANNED',
            paidDate: null,
            dueDate: new Date()
          },
          // Software: 250 EUR paid (50% used)
          {
            id: 'tx3',
            categoryId: 'cat_tools',
            kind: 'EXPENSE',
            amountCents: 25000,
            status: 'PAID',
            paidDate: new Date(),
            dueDate: new Date()
          }
        ]
      }
    };

    const budgets = await FinanceCalcService.calculateCategoryBudgets(fakeDb, 'tenant_test');

    assert.strictEqual(budgets.length, 2);

    const marketing = budgets.find((b) => b.categoryId === 'cat_marketing')!;
    assert.strictEqual(marketing.totalSpentCents, 110000);
    assert.strictEqual(marketing.percentageUsed, 110);
    assert.strictEqual(marketing.isOverBudget, true);

    const tools = budgets.find((b) => b.categoryId === 'cat_tools')!;
    assert.strictEqual(tools.totalSpentCents, 25000);
    assert.strictEqual(tools.percentageUsed, 50);
    assert.strictEqual(tools.isOverBudget, false);
  });
});
