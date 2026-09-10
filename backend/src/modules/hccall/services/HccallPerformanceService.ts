export class HccallPerformanceService {
  /**
   * Calcula performance com comparação a períodos homólogos normalizados por dias decorridos.
   */
  static async getPerformanceMetrics(db: any, tenantId: string, userId: string) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();

    // 1. Início e fim do mês corrente até hoje
    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    const endOfCurrentMonthSoFar = new Date(currentYear, currentMonth, currentDay, 23, 59, 59);

    // 2. Período homólogo do mês anterior (apenas até ao dia correspondente!)
    const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const startOfLastMonth = new Date(lastMonthYear, lastMonth, 1);
    const endOfLastMonthHomologous = new Date(lastMonthYear, lastMonth, currentDay, 23, 59, 59);

    // 3. Vendas do mês atual
    const currentMonthSales = await db.hccallSale.findMany({
      where: {
        tenantId,
        ownerUserId: userId,
        soldAt: { gte: startOfCurrentMonth, lte: endOfCurrentMonthSoFar },
        deletedAt: null
      },
      include: { items: { include: { product: true } }, dynamization: true }
    });

    // 4. Vendas do período homólogo do mês anterior
    const lastMonthHomologousSales = await db.hccallSale.findMany({
      where: {
        tenantId,
        ownerUserId: userId,
        soldAt: { gte: startOfLastMonth, lte: endOfLastMonthHomologous },
        deletedAt: null
      },
      include: { items: true }
    });

    // Métricas do Mês Atual
    const currentSalesCount = currentMonthSales.length;
    let currentRevenueCents = 0;
    let currentCommissionCents = 0;
    const dailyProductionMap = new Map<number, { count: number; commissionCents: number; revenueCents: number }>();

    for (let d = 1; d <= currentDay; d++) {
      dailyProductionMap.set(d, { count: 0, commissionCents: 0, revenueCents: 0 });
    }

    const productMap = new Map<string, { name: string; count: number; revenueCents: number }>();
    const dynamizationMap = new Map<string, { name: string; count: number }>();

    for (const sale of currentMonthSales) {
      currentCommissionCents += sale.commissionCents || 0;
      currentRevenueCents += sale.saleValueCents || 0;

      const day = new Date(sale.soldAt).getDate();
      const dayData = dailyProductionMap.get(day) || { count: 0, commissionCents: 0, revenueCents: 0 };
      dayData.count++;
      dayData.commissionCents += sale.commissionCents || 0;
      dayData.revenueCents += sale.saleValueCents || 0;
      dailyProductionMap.set(day, dayData);

      for (const item of sale.items || []) {
        const prodName = item.product?.name || sale.serviceName || 'Geral';
        const pData = productMap.get(prodName) || { name: prodName, count: 0, revenueCents: 0 };
        pData.count += item.quantity || 1;
        pData.revenueCents += item.totalPriceCents || 0;
        productMap.set(prodName, pData);
      }

      const dynName = sale.dynamization?.name || sale.promotionName || 'Sem Dinamização';
      const dData = dynamizationMap.get(dynName) || { name: dynName, count: 0 };
      dData.count++;
      dynamizationMap.set(dynName, dData);
    }

    // Métricas Homólogas
    const lastMonthCount = lastMonthHomologousSales.length;
    let lastMonthRevenueCents = 0;
    let lastMonthCommissionCents = 0;

    for (const sale of lastMonthHomologousSales) {
      lastMonthCommissionCents += sale.commissionCents || 0;
      lastMonthRevenueCents += sale.saleValueCents || 0;
    }

    const salesGrowthPct = lastMonthCount > 0 ? Math.round(((currentSalesCount - lastMonthCount) / lastMonthCount) * 100) : null;
    const commissionGrowthPct = lastMonthCommissionCents > 0 ? Math.round(((currentCommissionCents - lastMonthCommissionCents) / lastMonthCommissionCents) * 100) : null;

    // Calendário & Estatísticas Diárias
    const dailyList = Array.from(dailyProductionMap.entries()).map(([day, data]) => ({
      day,
      dateStr: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ...data
    }));

    let bestDay = dailyList[0] || null;
    let worstDay = dailyList[0] || null;

    for (const d of dailyList) {
      if (!bestDay || d.count > bestDay.count) bestDay = d;
      if (!worstDay || d.count < worstDay.count) worstDay = d;
    }

    const dailyAverage = currentDay > 0 ? parseFloat((currentSalesCount / currentDay).toFixed(1)) : 0;
    const weeklyAverage = parseFloat((dailyAverage * 5).toFixed(1));

    // Top Produto e Top Dinamização
    const sortedProducts = Array.from(productMap.values()).sort((a, b) => b.count - a.count);
    const sortedDyns = Array.from(dynamizationMap.values()).sort((a, b) => b.count - a.count);

    return {
      currentPeriod: {
        daysElapsed: currentDay,
        salesCount: currentSalesCount,
        revenueCents: currentRevenueCents,
        commissionCents: currentCommissionCents,
        dailyAverage,
        weeklyAverage
      },
      homologousPeriod: {
        daysElapsed: currentDay,
        salesCount: lastMonthCount,
        revenueCents: lastMonthRevenueCents,
        commissionCents: lastMonthCommissionCents,
        salesGrowthPct,
        commissionGrowthPct
      },
      highlights: {
        bestDay,
        worstDay,
        topProduct: sortedProducts[0] || null,
        topDynamization: sortedDyns[0] || null
      },
      dailyProduction: dailyList,
      productBreakdown: sortedProducts,
      dynamizationBreakdown: sortedDyns
    };
  }
}
