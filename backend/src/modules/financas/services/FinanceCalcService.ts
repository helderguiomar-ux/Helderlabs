export interface FinancialKPIs {
  currentBalanceCents: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  netResultCents: number;
  committedCents: number;
  overdueCents: number;
  availableBalanceCents: number;
  pendingIncomeCents: number;
  overdueIncomeCents: number;
}

export interface CashFlowDayPoint {
  date: string; // YYYY-MM-DD
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  projectedBalanceCents: number;
  transactionsCount: number;
}

export interface CashFlowProjectionResult {
  startDate: string;
  endDate: string;
  days: number;
  startingBalanceCents: number;
  endingBalanceCents: number;
  lowestProjectedBalanceCents: number;
  lowestProjectedDate: string | null;
  dailyPoints: CashFlowDayPoint[];
}

export interface BurnRateResult {
  monthlyAverageExpenseCents: number;
  monthlyAverageIncomeCents: number;
  netMonthlyBurnCents: number;
  runwayMonths: number | null; // null if infinite/profitable
  availableBalanceCents: number;
}

export interface CategoryBudgetStatus {
  categoryId: string;
  categoryName: string;
  kind: string;
  color: string | null;
  icon: string | null;
  budgetAmountCents: number;
  spentRealizedCents: number;
  spentCommittedCents: number;
  totalSpentCents: number;
  remainingCents: number;
  percentageUsed: number;
  isOverBudget: boolean;
}

export class FinanceCalcService {
  /**
   * Helper to format Date into YYYY-MM-DD string in UTC/local agnostic way.
   */
  static formatDateStr(d: Date | string): string {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toISOString().split('T')[0];
  }

  /**
   * Calculates the current balance, income, expenses, committed, overdue for a tenant.
   */
  static async calculateKPIs(
    db: any,
    tenantId: string,
    options?: { startDate?: Date; endDate?: Date }
  ): Promise<FinancialKPIs> {
    const todayStr = this.formatDateStr(new Date());
    const today = new Date(todayStr + 'T00:00:00.000Z');

    // 1. Get Accounts Opening Balances
    const accounts = await db.financeAccount.findMany({
      where: { tenantId, deletedAt: null }
    });
    const totalOpeningBalanceCents = accounts.reduce(
      (acc: number, a: { openingBalanceCents: number }) => acc + (a.openingBalanceCents || 0),
      0
    );

    // 2. Fetch all non-deleted transactions for current calculations
    const allTransactions = await db.financeTransaction.findMany({
      where: {
        tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        kind: true,
        type: true,
        amountCents: true,
        dueDate: true,
        paidDate: true,
        status: true,
        accountId: true,
        transferToId: true
      }
    });

    let currentBalanceCents = totalOpeningBalanceCents;
    let totalIncomeCents = 0;
    let totalExpenseCents = 0;
    let committedCents = 0;
    let overdueCents = 0;
    let pendingIncomeCents = 0;
    let overdueIncomeCents = 0;

    const startFilter = options?.startDate ? new Date(this.formatDateStr(options.startDate) + 'T00:00:00.000Z') : null;
    const endFilter = options?.endDate ? new Date(this.formatDateStr(options.endDate) + 'T23:59:59.999Z') : null;

    for (const tx of allTransactions) {
      const isTransfer = tx.type === 'TRANSFER' || tx.kind === 'TRANSFER';
      const isPaid = tx.status === 'PAID' || tx.paidDate !== null;
      const dueDate = new Date(tx.dueDate);
      const isOverdue = dueDate < today && !isPaid;

      // Global Balance calculation (includes all past paid transactions from beginning of time)
      if (isPaid && !isTransfer) {
        if (tx.kind === 'INCOME') {
          currentBalanceCents += tx.amountCents;
        } else if (tx.kind === 'EXPENSE') {
          currentBalanceCents -= tx.amountCents;
        }
      }

      // Period-filtered P&L aggregations
      const txEffectiveDate = tx.paidDate ? new Date(tx.paidDate) : dueDate;
      const inPeriod =
        (!startFilter || txEffectiveDate >= startFilter) &&
        (!endFilter || txEffectiveDate <= endFilter);

      if (inPeriod && !isTransfer) {
        if (isPaid) {
          if (tx.kind === 'INCOME') {
            totalIncomeCents += tx.amountCents;
          } else if (tx.kind === 'EXPENSE') {
            totalExpenseCents += tx.amountCents;
          }
        } else if (tx.status === 'PLANNED' || tx.status === 'PENDING') {
          if (tx.kind === 'EXPENSE') {
            if (isOverdue) {
              overdueCents += tx.amountCents;
            } else {
              committedCents += tx.amountCents;
            }
          } else if (tx.kind === 'INCOME') {
            if (isOverdue) {
              overdueIncomeCents += tx.amountCents;
            } else {
              pendingIncomeCents += tx.amountCents;
            }
          }
        }
      }
    }

    const netResultCents = totalIncomeCents - totalExpenseCents;
    const availableBalanceCents = currentBalanceCents - committedCents - overdueCents;

    return {
      currentBalanceCents,
      totalIncomeCents,
      totalExpenseCents,
      netResultCents,
      committedCents,
      overdueCents,
      availableBalanceCents,
      pendingIncomeCents,
      overdueIncomeCents
    };
  }

  /**
   * Generates a forward-looking daily cash flow projection for 7, 30, 60, or 90 days.
   * Merges real planned transactions with recurring rules projected in-memory.
   */
  static async calculateCashFlowProjections(
    db: any,
    tenantId: string,
    daysAhead: number = 90
  ): Promise<CashFlowProjectionResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + daysAhead);

    // Initial KPI balance
    const kpis = await this.calculateKPIs(db, tenantId);
    let runningBalance = kpis.currentBalanceCents;

    // Fetch planned transactions within [today, endDate]
    const plannedTxs = await db.financeTransaction.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'PLANNED',
        dueDate: {
          gte: today,
          lte: endDate
        }
      }
    });

    // Fetch active recurring rules
    const recurringRules = await db.recurringRule.findMany({
      where: {
        tenantId,
        active: true,
        deletedAt: null,
        startDate: { lte: endDate }
      }
    });

    // Day bucket map
    const dailyMap = new Map<string, { incomeCents: number; expenseCents: number; count: number }>();

    // Initialize all days
    for (let i = 0; i <= daysAhead; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dStr = this.formatDateStr(d);
      dailyMap.set(dStr, { incomeCents: 0, expenseCents: 0, count: 0 });
    }

    // 1. Place planned transactions into dailyMap
    for (const tx of plannedTxs) {
      const dStr = this.formatDateStr(tx.dueDate);
      const bucket = dailyMap.get(dStr);
      if (bucket) {
        if (tx.kind === 'INCOME') {
          bucket.incomeCents += tx.amountCents;
        } else if (tx.kind === 'EXPENSE') {
          bucket.expenseCents += tx.amountCents;
        }
        bucket.count++;
      }
    }

    // 2. Project recurring rules into dailyMap (avoiding double-counting materialized txs)
    for (const rule of recurringRules) {
      const ruleStart = new Date(this.formatDateStr(rule.startDate) + 'T00:00:00.000Z');
      const ruleEnd = rule.endDate ? new Date(this.formatDateStr(rule.endDate) + 'T23:59:59.999Z') : null;

      for (let i = 0; i <= daysAhead; i++) {
        const currentDate = new Date(today);
        currentDate.setDate(currentDate.getDate() + i);
        const dStr = this.formatDateStr(currentDate);

        if (currentDate < ruleStart) continue;
        if (ruleEnd && currentDate > ruleEnd) continue;

        let matches = false;
        if (rule.freq === 'WEEKLY') {
          const diffDays = Math.round((currentDate.getTime() - ruleStart.getTime()) / (1000 * 60 * 60 * 24));
          const interval = (rule.interval || 1) * 7;
          if (diffDays >= 0 && diffDays % interval === 0) {
            matches = true;
          }
        } else if (rule.freq === 'MONTHLY') {
          const targetDay = rule.dayOfMonth || ruleStart.getUTCDate();
          const daysInCurrentMonth = new Date(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0).getUTCDate();
          const effectiveTargetDay = Math.min(targetDay, daysInCurrentMonth);
          if (currentDate.getUTCDate() === effectiveTargetDay) {
            const monthDiff = (currentDate.getUTCFullYear() - ruleStart.getUTCFullYear()) * 12 + (currentDate.getUTCMonth() - ruleStart.getUTCMonth());
            const interval = rule.interval || 1;
            if (monthDiff >= 0 && monthDiff % interval === 0) {
              matches = true;
            }
          }
        } else if (rule.freq === 'QUARTERLY') {
          const targetDay = rule.dayOfMonth || ruleStart.getUTCDate();
          const daysInCurrentMonth = new Date(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0).getUTCDate();
          const effectiveTargetDay = Math.min(targetDay, daysInCurrentMonth);
          if (currentDate.getUTCDate() === effectiveTargetDay) {
            const monthDiff = (currentDate.getUTCFullYear() - ruleStart.getUTCFullYear()) * 12 + (currentDate.getUTCMonth() - ruleStart.getUTCMonth());
            if (monthDiff >= 0 && monthDiff % 3 === 0) {
              matches = true;
            }
          }
        } else if (rule.freq === 'YEARLY') {
          if (
            currentDate.getUTCMonth() === ruleStart.getUTCMonth() &&
            currentDate.getUTCDate() === ruleStart.getUTCDate()
          ) {
            matches = true;
          }
        }

        if (matches) {
          const alreadyMaterialized = plannedTxs.some(
            (tx: { recurringRuleId?: string | null; dueDate: Date }) =>
              tx.recurringRuleId === rule.id && this.formatDateStr(tx.dueDate) === dStr
          );

          if (!alreadyMaterialized) {
            const bucket = dailyMap.get(dStr);
            if (bucket) {
              if (rule.kind === 'INCOME') {
                bucket.incomeCents += rule.amountCents;
              } else {
                bucket.expenseCents += rule.amountCents;
              }
              bucket.count++;
            }
          }
        }
      }
    }

    // Build timeline series
    const dailyPoints: CashFlowDayPoint[] = [];
    let lowestBalance = runningBalance;
    let lowestDate: string | null = this.formatDateStr(today);

    const sortedDates = Array.from(dailyMap.keys()).sort();
    for (const dStr of sortedDates) {
      const bucket = dailyMap.get(dStr)!;
      const netCents = bucket.incomeCents - bucket.expenseCents;
      runningBalance += netCents;

      if (runningBalance < lowestBalance) {
        lowestBalance = runningBalance;
        lowestDate = dStr;
      }

      dailyPoints.push({
        date: dStr,
        incomeCents: bucket.incomeCents,
        expenseCents: bucket.expenseCents,
        netCents,
        projectedBalanceCents: runningBalance,
        transactionsCount: bucket.count
      });
    }

    return {
      startDate: this.formatDateStr(today),
      endDate: this.formatDateStr(endDate),
      days: daysAhead,
      startingBalanceCents: kpis.currentBalanceCents,
      endingBalanceCents: runningBalance,
      lowestProjectedBalanceCents: lowestBalance,
      lowestProjectedDate: lowestDate,
      dailyPoints
    };
  }

  /**
   * Calculates 3-month rolling burn rate and available runway in months.
   */
  static async calculateBurnRate(db: any, tenantId: string): Promise<BurnRateResult> {
    const today = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const kpis = await this.calculateKPIs(db, tenantId, {
      startDate: threeMonthsAgo,
      endDate: today
    });

    const monthlyAverageExpenseCents = Math.round(kpis.totalExpenseCents / 3);
    const monthlyAverageIncomeCents = Math.round(kpis.totalIncomeCents / 3);
    const netMonthlyBurnCents = monthlyAverageExpenseCents - monthlyAverageIncomeCents;

    let runwayMonths: number | null = null;
    if (netMonthlyBurnCents > 0 && kpis.availableBalanceCents > 0) {
      runwayMonths = Number((kpis.availableBalanceCents / netMonthlyBurnCents).toFixed(1));
    } else if (kpis.availableBalanceCents <= 0) {
      runwayMonths = 0;
    }

    return {
      monthlyAverageExpenseCents,
      monthlyAverageIncomeCents,
      netMonthlyBurnCents,
      runwayMonths,
      availableBalanceCents: kpis.availableBalanceCents
    };
  }

  /**
   * Computes monthly budget execution status for all expense categories.
   */
  static async calculateCategoryBudgets(
    db: any,
    tenantId: string,
    yearMonth?: string // Format 'YYYY-MM', defaults to current month
  ): Promise<CategoryBudgetStatus[]> {
    const now = new Date();
    const targetYM = yearMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yearStr, monthStr] = targetYM.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const categories = await db.financeCategory.findMany({
      where: {
        tenantId,
        archivedAt: null,
        deletedAt: null,
        kind: 'EXPENSE'
      },
      orderBy: { sortOrder: 'asc' }
    });

    const transactions = await db.financeTransaction.findMany({
      where: {
        tenantId,
        deletedAt: null,
        kind: 'EXPENSE',
        dueDate: {
          gte: monthStart,
          lte: monthEnd
        }
      }
    });

    return categories.map((cat: any) => {
      const catTxs = transactions.filter((t: any) => t.categoryId === cat.id);
      let spentRealizedCents = 0;
      let spentCommittedCents = 0;

      for (const t of catTxs) {
        if (t.status === 'PAID' || t.paidDate !== null) {
          spentRealizedCents += t.amountCents;
        } else if (t.status === 'PLANNED' || t.status === 'PENDING') {
          spentCommittedCents += t.amountCents;
        }
      }

      const totalSpentCents = spentRealizedCents + spentCommittedCents;
      const budgetAmountCents = cat.budgetAmountCents || 0;
      const remainingCents = budgetAmountCents > 0 ? budgetAmountCents - totalSpentCents : 0;
      const percentageUsed =
        budgetAmountCents > 0 ? Math.round((totalSpentCents / budgetAmountCents) * 100) : 0;
      const isOverBudget = budgetAmountCents > 0 && totalSpentCents > budgetAmountCents;

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        kind: cat.kind,
        color: cat.color,
        icon: cat.icon,
        budgetAmountCents,
        spentRealizedCents,
        spentCommittedCents,
        totalSpentCents,
        remainingCents,
        percentageUsed,
        isOverBudget
      };
    });
  }
}
