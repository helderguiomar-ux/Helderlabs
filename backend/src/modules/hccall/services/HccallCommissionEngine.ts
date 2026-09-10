/**
 * HCCALL 2.0 — Motor Puro de Cálculo de Comissões e Simulação Comercial
 *
 * REQUISITOS DE DESIGN:
 * 1. Camada 100% Pura: Zero I/O, zero base de dados, zero DOM.
 * 2. Determinismo e Idempotência: A mesma entrada produz rigorosamente a mesma saída.
 * 3. Suporte aos 3 modos de escalão:
 *    - RETROACTIVE: Ao atingir um escalão, todas as vendas do período são comissionadas pelo valor do novo escalão.
 *    - MARGINAL: Cada bloco de vendas é comissionado pelo valor do seu respetivo escalão.
 *    - FLAT: Valor fixo unitário ou base por venda sem progressão por escalões.
 * 4. Explicabilidade: Gera decomposição de cálculo detalhada em linguagem natural.
 */

export type TierMode = 'RETROACTIVE' | 'MARGINAL' | 'FLAT';

export interface TierConfig {
  minQuantity: number;
  maxQuantity: number | null; // null significa sem limite superior (ex: 31+)
  unitAmountCents: number;
}

export interface BonusConfig {
  thresholdCount: number;
  bonusAmountCents: number;
}

export interface DynamizationConfig {
  id: string;
  name: string;
  tierMode: TierMode;
  baseAmountPerSaleCents?: number;
  tiers?: TierConfig[];
  bonuses?: BonusConfig[];
}

export interface SaleItemInput {
  productId: string;
  productName?: string;
  category?: string;
  quantity: number;
  unitPriceCents?: number;
}

export interface SaleInput {
  id?: string;
  code?: string;
  dynamizationId?: string;
  soldAt: string | Date;
  items: SaleItemInput[];
  manualCommissionCents?: number;
}

export interface CalculationBreakdownLine {
  concept: string;
  quantity: number;
  unitAmountCents: number;
  totalAmountCents: number;
  explanation: string;
}

export interface DynamizationCalculationResult {
  dynamizationId: string;
  dynamizationName: string;
  tierMode: TierMode;
  totalSalesCount: number;
  tierReached: TierConfig | null;
  nextTier: {
    neededSalesCount: number;
    unitAmountCents: number;
    salesRemaining: number;
    potentialGainCents: number;
  } | null;
  baseCommissionCents: number;
  tierCommissionCents: number;
  bonusCommissionCents: number;
  totalCommissionCents: number;
  lines: CalculationBreakdownLine[];
  explanation: string;
}

export interface EngineCalculationResult {
  totalSalesCount: number;
  totalRevenueCents: number;
  totalEstimatedCommissionCents: number;
  dynamizationResults: DynamizationCalculationResult[];
  breakdownLines: CalculationBreakdownLine[];
}

export class HccallCommissionEngine {
  private static normalizeTiers(tiers: TierConfig[]): TierConfig[] {
    return [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  }

  private static normalizeBonuses(bonuses: BonusConfig[]): BonusConfig[] {
    return [...bonuses].sort((a, b) => a.thresholdCount - b.thresholdCount);
  }

  public static calculateDynamization(
    config: DynamizationConfig,
    salesCount: number,
    totalRevenueCents: number = 0
  ): DynamizationCalculationResult {
    const tierMode = config.tierMode || 'RETROACTIVE';
    const tiers = this.normalizeTiers(config.tiers || []);
    const bonuses = this.normalizeBonuses(config.bonuses || []);
    const lines: CalculationBreakdownLine[] = [];

    let baseCommissionCents = 0;
    let tierCommissionCents = 0;
    let bonusCommissionCents = 0;
    let tierReached: TierConfig | null = null;
    let nextTier: DynamizationCalculationResult['nextTier'] = null;

    // 1. Comissão Base Fixa (se existir)
    if (config.baseAmountPerSaleCents && config.baseAmountPerSaleCents > 0 && salesCount > 0) {
      baseCommissionCents = salesCount * config.baseAmountPerSaleCents;
      lines.push({
        concept: 'Comissão Base',
        quantity: salesCount,
        unitAmountCents: config.baseAmountPerSaleCents,
        totalAmountCents: baseCommissionCents,
        explanation: `${salesCount} venda(s) × ${(config.baseAmountPerSaleCents / 100).toFixed(2)} € base = ${(baseCommissionCents / 100).toFixed(2)} €`
      });
    }

    // 2. Cálculo de Escalões
    if (tiers.length > 0 && salesCount > 0) {
      for (const tier of tiers) {
        if (salesCount >= tier.minQuantity) {
          if (tier.maxQuantity === null || salesCount <= tier.maxQuantity) {
            tierReached = tier;
          } else if (salesCount > (tier.maxQuantity ?? 0)) {
            tierReached = tier;
          }
        }
      }

      const upcomingTier = tiers.find(t => t.minQuantity > salesCount);
      if (upcomingTier) {
        const salesRemaining = upcomingTier.minQuantity - salesCount;
        let potentialGain = 0;
        if (tierMode === 'RETROACTIVE') {
          const futureTotal = upcomingTier.minQuantity * upcomingTier.unitAmountCents;
          const currentTotal = salesCount * (tierReached ? tierReached.unitAmountCents : 0);
          potentialGain = futureTotal - currentTotal;
        } else if (tierMode === 'MARGINAL') {
          potentialGain = salesRemaining * upcomingTier.unitAmountCents;
        } else {
          potentialGain = salesRemaining * upcomingTier.unitAmountCents;
        }

        nextTier = {
          neededSalesCount: upcomingTier.minQuantity,
          unitAmountCents: upcomingTier.unitAmountCents,
          salesRemaining,
          potentialGainCents: Math.max(0, potentialGain)
        };
      }

      if (tierMode === 'RETROACTIVE') {
        if (tierReached) {
          tierCommissionCents = salesCount * tierReached.unitAmountCents;
          const maxLabel = tierReached.maxQuantity ? `${tierReached.maxQuantity}` : '+';
          lines.push({
            concept: `Escalão Retroativo (${tierReached.minQuantity}–${maxLabel})`,
            quantity: salesCount,
            unitAmountCents: tierReached.unitAmountCents,
            totalAmountCents: tierCommissionCents,
            explanation: `Escalão atingido: ${salesCount} venda(s) × ${(tierReached.unitAmountCents / 100).toFixed(2)} € (retroativo a todas as vendas) = ${(tierCommissionCents / 100).toFixed(2)} €`
          });
        }
      } else if (tierMode === 'MARGINAL') {
        let remainingToAllocate = salesCount;
        let runningSum = 0;

        for (const tier of tiers) {
          if (remainingToAllocate <= 0) break;

          const tierCapacity = tier.maxQuantity !== null
            ? (tier.maxQuantity - tier.minQuantity + 1)
            : remainingToAllocate;

          const countInTier = Math.min(remainingToAllocate, Math.max(0, tierCapacity));

          if (countInTier > 0) {
            const amountInTier = countInTier * tier.unitAmountCents;
            runningSum += amountInTier;
            remainingToAllocate -= countInTier;

            const maxLabel = tier.maxQuantity ? `${tier.maxQuantity}` : '+';
            lines.push({
              concept: `Escalão Marginal (${tier.minQuantity}–${maxLabel})`,
              quantity: countInTier,
              unitAmountCents: tier.unitAmountCents,
              totalAmountCents: amountInTier,
              explanation: `Bloco de ${countInTier} venda(s) × ${(tier.unitAmountCents / 100).toFixed(2)} € = ${(amountInTier / 100).toFixed(2)} €`
            });
          }
        }
        tierCommissionCents = runningSum;
      } else if (tierMode === 'FLAT') {
        if (tierReached) {
          tierCommissionCents = salesCount * tierReached.unitAmountCents;
          lines.push({
            concept: 'Taxa Fixa Unitária',
            quantity: salesCount,
            unitAmountCents: tierReached.unitAmountCents,
            totalAmountCents: tierCommissionCents,
            explanation: `${salesCount} venda(s) × ${(tierReached.unitAmountCents / 100).toFixed(2)} € = ${(tierCommissionCents / 100).toFixed(2)} €`
          });
        }
      }
    }

    // 3. Bónus de Objetivo
    if (bonuses.length > 0 && salesCount > 0) {
      const achievedBonuses = bonuses.filter(b => salesCount >= b.thresholdCount);
      if (achievedBonuses.length > 0) {
        const topBonus = achievedBonuses[achievedBonuses.length - 1];
        bonusCommissionCents = topBonus.bonusAmountCents;
        lines.push({
          concept: `Bónus de Objetivo (≥ ${topBonus.thresholdCount} vendas)`,
          quantity: 1,
          unitAmountCents: topBonus.bonusAmountCents,
          totalAmountCents: topBonus.bonusAmountCents,
          explanation: `Meta de ${topBonus.thresholdCount} vendas superada: +${(topBonus.bonusAmountCents / 100).toFixed(2)} € de bónus`
        });
      }
    }

    const totalCommissionCents = baseCommissionCents + tierCommissionCents + bonusCommissionCents;

    // 4. Construção da explicação em linguagem natural
    let explanation = `🚀 ${config.name}\n`;
    explanation += `Vendas registadas: ${salesCount}\n`;
    explanation += `Comissão calculada: ${(totalCommissionCents / 100).toFixed(2)} €`;

    if (nextTier) {
      explanation += `\n🎯 Próximo escalão: faltam ${nextTier.salesRemaining} venda(s) para atingir ${nextTier.neededSalesCount} (${(nextTier.unitAmountCents / 100).toFixed(2)} €/venda).`;
      explanation += `\n💰 Potencial de ganho adicional: +${(nextTier.potentialGainCents / 100).toFixed(2)} €`;
    }

    return {
      dynamizationId: config.id,
      dynamizationName: config.name,
      tierMode,
      totalSalesCount: salesCount,
      tierReached,
      nextTier,
      baseCommissionCents,
      tierCommissionCents,
      bonusCommissionCents,
      totalCommissionCents,
      lines,
      explanation
    };
  }

  public static calculateSalesBatch(
    sales: SaleInput[],
    dynamizations: DynamizationConfig[]
  ): EngineCalculationResult {
    let totalSalesCount = 0;
    let totalRevenueCents = 0;
    const dynamizationMap = new Map<string, DynamizationConfig>();
    dynamizations.forEach(d => dynamizationMap.set(d.id, d));

    const salesByDynamization = new Map<string, { count: number; revenueCents: number; manualCommissionCents: number }>();

    for (const sale of sales) {
      totalSalesCount++;
      let saleRevenue = 0;
      let itemsCount = 0;

      for (const item of sale.items || []) {
        const qty = item.quantity || 1;
        const price = item.unitPriceCents || 0;
        saleRevenue += qty * price;
        itemsCount += qty;
      }
      totalRevenueCents += saleRevenue;

      const dynId = sale.dynamizationId || 'DEFAULT_DYN';
      const existing = salesByDynamization.get(dynId) || { count: 0, revenueCents: 0, manualCommissionCents: 0 };
      existing.count += (itemsCount > 0 ? itemsCount : 1);
      existing.revenueCents += saleRevenue;
      if (sale.manualCommissionCents !== undefined && sale.manualCommissionCents !== null) {
        existing.manualCommissionCents += sale.manualCommissionCents;
      }
      salesByDynamization.set(dynId, existing);
    }

    const dynamizationResults: DynamizationCalculationResult[] = [];
    const breakdownLines: CalculationBreakdownLine[] = [];
    let totalEstimatedCommissionCents = 0;

    for (const [dynId, data] of salesByDynamization.entries()) {
      const config = dynamizationMap.get(dynId);
      if (config) {
        const res = this.calculateDynamization(config, data.count, data.revenueCents);
        dynamizationResults.push(res);
        breakdownLines.push(...res.lines);
        totalEstimatedCommissionCents += res.totalCommissionCents;
      } else if (data.manualCommissionCents > 0) {
        totalEstimatedCommissionCents += data.manualCommissionCents;
        const line: CalculationBreakdownLine = {
          concept: 'Comissão Manual / Direta',
          quantity: data.count,
          unitAmountCents: Math.round(data.manualCommissionCents / data.count),
          totalAmountCents: data.manualCommissionCents,
          explanation: `${data.count} venda(s) com comissão direta atribuída = ${(data.manualCommissionCents / 100).toFixed(2)} €`
        };
        breakdownLines.push(line);
      }
    }

    return {
      totalSalesCount,
      totalRevenueCents,
      totalEstimatedCommissionCents,
      dynamizationResults,
      breakdownLines
    };
  }

  public static simulateAdditionalSales(
    currentSales: SaleInput[],
    dynamization: DynamizationConfig,
    additionalSalesCount: number
  ): {
    current: DynamizationCalculationResult;
    projected: DynamizationCalculationResult;
    additionalSalesCount: number;
    additionalGainCents: number;
    tierUpgraded: boolean;
    bonusUnlocked: boolean;
    explanation: string;
  } {
    let currentCount = 0;
    for (const s of currentSales) {
      if (s.dynamizationId === dynamization.id) {
        const itemsQty = (s.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0);
        currentCount += itemsQty > 0 ? itemsQty : 1;
      }
    }

    const currentResult = this.calculateDynamization(dynamization, currentCount);
    const projectedResult = this.calculateDynamization(dynamization, currentCount + additionalSalesCount);
    const additionalGainCents = projectedResult.totalCommissionCents - currentResult.totalCommissionCents;

    const tierUpgraded = (projectedResult.tierReached?.unitAmountCents ?? 0) > (currentResult.tierReached?.unitAmountCents ?? 0);
    const bonusUnlocked = projectedResult.bonusCommissionCents > currentResult.bonusCommissionCents;

    let explanation = `Atualmente: ${(currentResult.totalCommissionCents / 100).toFixed(2)} € (${currentCount} vendas)\n`;
    explanation += `+${additionalSalesCount} vendas → ${(projectedResult.totalCommissionCents / 100).toFixed(2)} € (${currentCount + additionalSalesCount} vendas)\n`;
    explanation += `Ganho adicional → +${(additionalGainCents / 100).toFixed(2)} €`;

    if (tierUpgraded) {
      explanation += `\n🎉 Desbloqueia novo escalão a ${(projectedResult.tierReached!.unitAmountCents / 100).toFixed(2)} €/venda!`;
    }
    if (bonusUnlocked) {
      explanation += `\n💰 Desbloqueia bónus de meta de +${((projectedResult.bonusCommissionCents - currentResult.bonusCommissionCents) / 100).toFixed(2)} €!`;
    }

    return {
      current: currentResult,
      projected: projectedResult,
      additionalSalesCount,
      additionalGainCents,
      tierUpgraded,
      bonusUnlocked,
      explanation
    };
  }
}
