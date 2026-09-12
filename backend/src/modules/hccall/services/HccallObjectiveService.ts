/**
 * Fuso horário por omissão do utilizador.
 *
 * countWorkingDays e calculatePace usavam getDay()/setHours(), ou seja, a hora
 * LOCAL DO SERVIDOR. Com o servidor em UTC e o utilizador em Europe/Lisbon, uma
 * venda registada às 00:30 de um dia de verão caía no dia anterior. Num sistema
 * cujo indicador central é "quantas vendas fiz hoje face ao objetivo", isso é um
 * erro de domínio e não um detalhe cosmético.
 *
 * Toda a aritmética de datas passa a ser feita no fuso explícito do utilizador.
 */
export const DEFAULT_HCCALL_TIMEZONE = 'Europe/Lisbon';

/** Componentes civis (ano/mês/dia/dia-da-semana) de um instante, num dado fuso. */
function civilPartsInZone(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: weekdayMap[get('weekday')] ?? 0
  };
}

/** Número de dias desde a época, contado no calendário civil do fuso indicado. */
function civilDayNumber(date: Date, timeZone: string): number {
  const { y, m, d } = civilPartsInZone(date, timeZone);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Dia da semana (0=domingo) de um número de dia civil. */
function weekdayOfDayNumber(dayNumber: number): number {
  const ms = dayNumber * 86_400_000;
  return new Date(ms).getUTCDay();
}

export class HccallObjectiveService {
  /**
   * Calcula o número de dias úteis entre duas datas, no calendário civil do
   * fuso horário do utilizador (inclusive em ambas as pontas).
   */
  public static countWorkingDays(
    startDate: Date,
    endDate: Date,
    workingDaysConfig: { monday?: boolean; tuesday?: boolean; wednesday?: boolean; thursday?: boolean; friday?: boolean; saturday?: boolean; sunday?: boolean } = {},
    timeZone: string = DEFAULT_HCCALL_TIMEZONE
  ): number {
    const config: Record<number, boolean> = {
      1: workingDaysConfig?.monday !== false,
      2: workingDaysConfig?.tuesday !== false,
      3: workingDaysConfig?.wednesday !== false,
      4: workingDaysConfig?.thursday !== false,
      5: workingDaysConfig?.friday !== false,
      6: workingDaysConfig?.saturday === true,
      0: workingDaysConfig?.sunday === true
    };

    const startDay = civilDayNumber(startDate, timeZone);
    const endDay = civilDayNumber(endDate, timeZone);
    if (endDay < startDay) return 0;

    let count = 0;
    for (let day = startDay; day <= endDay; day++) {
      if (config[weekdayOfDayNumber(day)]) count++;
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
    currentDate: Date = new Date(),
    timeZone: string = DEFAULT_HCCALL_TIMEZONE
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const now = new Date(currentDate);

    const totalWorkingDays = Math.max(1, this.countWorkingDays(start, end, workingDaysConfig, timeZone));
    const elapsedWorkingDays = Math.max(0, this.countWorkingDays(start, now > end ? end : now, workingDaysConfig, timeZone));
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

  /**
   * Atualiza um objetivo do próprio utilizador. O CRUD estava incompleto:
   * existiam apenas listagem e criação, pelo que um objetivo mal introduzido
   * não podia ser corrigido nem removido.
   */
  static async updateObjective(
    db: any,
    tenantId: string,
    userId: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      type?: string;
      targetValue?: number;
      unit?: string;
      periodStart?: string | Date;
      periodEnd?: string | Date;
      productId?: string;
      orgContextId?: string;
    }
  ) {
    const existing = await db.hccallObjective.findFirst({
      where: { id, tenantId, userId, deletedAt: null }
    });
    if (!existing) return null;

    const patch: any = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.type !== undefined) patch.type = data.type;
    if (data.targetValue !== undefined) patch.targetValue = data.targetValue;
    if (data.unit !== undefined) patch.unit = data.unit;
    if (data.periodStart !== undefined) patch.periodStart = new Date(data.periodStart);
    if (data.periodEnd !== undefined) patch.periodEnd = new Date(data.periodEnd);
    if (data.productId !== undefined) patch.productId = data.productId;
    if (data.orgContextId !== undefined) patch.orgContextId = data.orgContextId;

    const periodStart = patch.periodStart ?? existing.periodStart;
    const periodEnd = patch.periodEnd ?? existing.periodEnd;
    if (new Date(periodEnd) < new Date(periodStart)) {
      throw new Error('O fim do período não pode ser anterior ao início.');
    }

    return db.hccallObjective.update({ where: { id }, data: patch });
  }

  /**
   * Remoção lógica (soft delete) — o histórico de desempenho não se apaga.
   */
  static async deleteObjective(db: any, tenantId: string, userId: string, id: string) {
    const existing = await db.hccallObjective.findFirst({
      where: { id, tenantId, userId, deletedAt: null }
    });
    if (!existing) return null;

    return db.hccallObjective.update({
      where: { id },
      data: { deletedAt: new Date() }
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
