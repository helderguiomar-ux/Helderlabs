export class HccallObjectiveService {
  /**
   * Calcula o número de dias úteis entre duas datas considerando a configuração do utilizador.
   */
  public static countWorkingDays(
    startDate: Date,
    endDate: Date,
    workingDaysConfig: { monday?: boolean; tuesday?: boolean; wednesday?: boolean; thursday?: boolean; friday?: boolean; saturday?: boolean; sunday?: boolean } = {}
  ): number {
    const config = {
      1: workingDaysConfig.monday !== false,
      2: workingDaysConfig.tuesday !== false,
      3: workingDaysConfig.wednesday !== false,
      4: workingDaysConfig.thursday !== false,
      5: workingDaysConfig.friday !== false,
      6: workingDaysConfig.saturday === true,
      0: workingDaysConfig.sunday === true
    };

    let count = 0;
    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (cur <= end) {
      const dayOfWeek = cur.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      if (config[dayOfWeek]) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  /**
   * Calcula o ritmo e previsão determinística para um objetivo.
   */
  public static calculatePace(
    currentValue: number,
    targetValue: number,
    periodStart: Date,
    periodEnd: Date,
    workingDaysConfig?: any,
    currentDate: Date = new Date()
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const now = new Date(currentDate);

    const totalWorkingDays = Math.max(1, this.countWorkingDays(start, end, workingDaysConfig));
    const elapsedWorkingDays = Math.max(0, this.countWorkingDays(start, now > end ? end : now, workingDaysConfig));
    const remainingWorkingDays = Math.max(0, totalWorkingDays - elapsedWorkingDays);

    const percentAchieved = targetValue > 0 ? Math.round((currentValue / targetValue) * 100) : 0;
    const remainingToTarget = Math.max(0, targetValue - currentValue);

    let currentDailyPace = 0;
    let requiredDailyPace = 0;
    let projectedEndValue = currentValue;
    let hasEnoughData = elapsedWorkingDays >= 1;
    let statusAssessment: 'ON_TRACK' | 'AT_RISK' | 'ACHIEVED' | 'MISSED' | 'INSUFFICIENT_DATA' = 'ON_TRACK';

    if (currentValue >= targetValue) {
      statusAssessment = 'ACHIEVED';
    } else if (remainingWorkingDays === 0 && currentValue < targetValue) {
      statusAssessment = 'MISSED';
    } else if (!hasEnoughData) {
      statusAssessment = 'INSUFFICIENT_DATA';
      requiredDailyPace = totalWorkingDays > 0 ? parseFloat((targetValue / totalWorkingDays).toFixed(1)) : 0;
    } else {
      currentDailyPace = parseFloat((currentValue / elapsedWorkingDays).toFixed(2));
      requiredDailyPace = remainingWorkingDays > 0 ? parseFloat((remainingToTarget / remainingWorkingDays).toFixed(2)) : 0;
      projectedEndValue = Math.round(currentValue + (currentDailyPace * remainingWorkingDays));

      if (projectedEndValue >= targetValue) {
        statusAssessment = 'ON_TRACK';
      } else {
        statusAssessment = 'AT_RISK';
      }
    }

    return {
      currentValue,
      targetValue,
      percentAchieved,
      remainingToTarget,
      totalWorkingDays,
      elapsedWorkingDays,
      remainingWorkingDays,
      currentDailyPace,
      requiredDailyPace,
      projectedEndValue,
      hasEnoughData,
      statusAssessment
    };
  }

  static async listObjectives(db: any, tenantId: string, userId: string) {
    const objectives = await db.hccallObjective.findMany({
      where: { tenantId, userId, deletedAt: null },
      orderBy: { periodEnd: 'asc' }
    });

    // Recalcular métricas de ritmo para cada objetivo
    const now = new Date();
    return objectives.map((obj: any) => {
      const pace = this.calculatePace(
        obj.currentValue,
        obj.targetValue,
        obj.periodStart,
        obj.periodEnd,
        undefined,
        now
      );
      return {
        ...obj,
        pace
      };
    });
  }

  static async createObjective(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      name: string;
      description?: string;
      type: string;
      targetValue: number;
      unit?: string;
      periodStart: string | Date;
      periodEnd: string | Date;
      productId?: string;
      orgContextId?: string;
    }
  ) {
    return db.hccallObjective.create({
      data: {
        tenantId,
        userId,
        name: data.name,
        description: data.description,
        type: data.type || 'SALES_COUNT',
        targetValue: data.targetValue,
        unit: data.unit || 'vendas',
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        currentValue: 0,
        status: 'ACTIVE',
        productId: data.productId,
        orgContextId: data.orgContextId
      }
    });
  }
}
