import crypto from 'node:crypto';
import { HccallCommissionEngine } from './HccallCommissionEngine';
import { HccallObjectiveService } from './HccallObjectiveService';

export interface AlertData {
  code: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  fingerprint: string;
}

export class HccallAlertService {
  /**
   * Avalia o estado do utilizador e gera alertas determinísticos e acionáveis.
   */
  static async evaluateAndSyncAlerts(db: any, tenantId: string, userId: string) {
    const alertsToCreate: AlertData[] = [];
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Obter Vendas do Mês Atual
    const sales = await db.hccallSale.findMany({
      where: {
        tenantId,
        ownerUserId: userId,
        soldAt: { gte: currentMonthStart },
        deletedAt: null
      },
      include: { items: true, dynamization: true }
    });

    // 2. Obter Dinamizações Ativas
    const dynamizations = await db.hccallDynamization.findMany({
      where: { tenantId, userId, active: true, deletedAt: null },
      include: { tiers: true, bonuses: true }
    });

    // 3. Obter Objetivos Ativos
    const objectives = await db.hccallObjective.findMany({
      where: { tenantId, userId, deletedAt: null }
    });

    // A. Alertas de Dinamizações e Próximos Escalões
    for (const dyn of dynamizations) {
      const dynSales = sales.filter((s: any) => s.dynamizationId === dyn.id);
      const itemsCount = dynSales.reduce((acc: number, s: any) => {
        const q = (s.items || []).reduce((iq: number, i: any) => iq + (i.quantity || 1), 0);
        return acc + (q > 0 ? q : 1);
      }, 0);

      const dynConfig = {
        id: dyn.id,
        name: dyn.name,
        tierMode: dyn.tierMode as any,
        tiers: dyn.tiers.map((t: any) => ({
          minQuantity: t.minQuantity,
          maxQuantity: t.maxQuantity,
          unitAmountCents: t.unitAmountCents
        })),
        bonuses: dyn.bonuses.map((b: any) => ({
          thresholdCount: b.thresholdCount,
          bonusAmountCents: b.bonusAmountCents
        }))
      };

      const calc = HccallCommissionEngine.calculateDynamization(dynConfig, itemsCount);

      // Se está a 3 ou menos vendas do próximo escalão
      if (calc.nextTier && calc.nextTier.salesRemaining <= 3 && calc.nextTier.salesRemaining > 0) {
        const fp = crypto.createHash('md5').update(`tier_close_${dyn.id}_${calc.nextTier.neededSalesCount}_${now.toISOString().split('T')[0]}`).digest('hex');
        alertsToCreate.push({
          code: 'TIER_CLOSE',
          severity: 'INFO',
          title: `🎯 Próximo Escalão: ${dyn.name}`,
          message: `Faltam apenas ${calc.nextTier.salesRemaining} venda(s) para subir para ${(calc.nextTier.unitAmountCents / 100).toFixed(2)} €/venda (+${(calc.nextTier.potentialGainCents / 100).toFixed(2)} €).`,
          actionLabel: 'Registar Venda',
          actionUrl: '#new-sale',
          fingerprint: fp
        });
      }
    }

    // B. Alertas de Objetivos em Risco
    for (const obj of objectives) {
      const pace = HccallObjectiveService.calculatePace(
        obj.currentValue,
        obj.targetValue,
        obj.periodStart,
        obj.periodEnd,
        undefined,
        now
      );

      if (pace.statusAssessment === 'AT_RISK' && pace.remainingWorkingDays > 0) {
        const fp = crypto.createHash('md5').update(`obj_risk_${obj.id}_${now.toISOString().split('T')[0]}`).digest('hex');
        alertsToCreate.push({
          code: 'OBJECTIVE_AT_RISK',
          severity: 'WARNING',
          title: `⚠️ Objetivo em Risco: ${obj.name}`,
          message: `Estás com ritmo de ${pace.currentDailyPace} vendas/dia. Precisas de ${pace.requiredDailyPace} vendas/dia nos restantes ${pace.remainingWorkingDays} dias úteis.`,
          actionLabel: 'Ver Objetivo',
          actionUrl: '#objectives',
          fingerprint: fp
        });
      } else if (pace.statusAssessment === 'ACHIEVED') {
        const fp = crypto.createHash('md5').update(`obj_achieved_${obj.id}`).digest('hex');
        alertsToCreate.push({
          code: 'OBJECTIVE_ACHIEVED',
          severity: 'SUCCESS',
          title: `🎉 Objetivo Atingido: ${obj.name}`,
          message: `Parabéns! Ultrapassaste a meta de ${obj.targetValue} ${obj.unit} com ${obj.currentValue} registados.`,
          actionLabel: 'Ver Detalhes',
          actionUrl: '#objectives',
          fingerprint: fp
        });
      }
    }

    // C. Alerta de Integridade (vendas sem dinamização)
    const orphanSales = sales.filter((s: any) => !s.dynamizationId);
    if (orphanSales.length > 0) {
      const fp = crypto.createHash('md5').update(`orphan_sales_${orphanSales.length}_${now.toISOString().split('T')[0]}`).digest('hex');
      alertsToCreate.push({
        code: 'INTEGRITY_CHECK',
        severity: 'WARNING',
        title: `🔍 Integridade: ${orphanSales.length} Venda(s) Sem Dinamização`,
        message: `Existem vendas sem dinamização associada. Associa-as para não perderes comissão de escalão.`,
        actionLabel: 'Rever Vendas',
        actionUrl: '#sales',
        fingerprint: fp
      });
    }

    // Persistir e sincronizar alertas (idempotente com upsert por fingerprint)
    for (const a of alertsToCreate) {
      await db.hccallAlert.upsert({
        where: {
          tenantId_userId_fingerprint: {
            tenantId,
            userId,
            fingerprint: a.fingerprint
          }
        },
        create: {
          tenantId,
          userId,
          code: a.code,
          severity: a.severity,
          title: a.title,
          message: a.message,
          actionLabel: a.actionLabel,
          actionUrl: a.actionUrl,
          fingerprint: a.fingerprint
        },
        update: {
          title: a.title,
          message: a.message
        }
      });
    }

    // Retornar alertas não dispensados
    return db.hccallAlert.findMany({
      where: { tenantId, userId, isDismissed: false },
      orderBy: { createdAt: 'desc' }
    });
  }

  static async dismissAlert(db: any, tenantId: string, userId: string, alertId: string) {
    return db.hccallAlert.update({
      where: { id: alertId },
      data: { isDismissed: true }
    });
  }
}
