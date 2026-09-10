export class HccallOrgContextService {
  static async getCurrentContext(db: any, tenantId: string, userId: string) {
    let ctx = await db.hccallOrgContext.findFirst({
      where: { tenantId, userId, isCurrent: true }
    });

    if (!ctx) {
      // Criar contexto inicial se ainda não existir
      ctx = await db.hccallOrgContext.create({
        data: {
          tenantId,
          userId,
          companyName: 'HelderLabs Commercial',
          workplace: 'Operação Principal',
          jobRole: 'Consultor Comercial',
          operationType: 'CALL_CENTER',
          businessArea: 'TELECOM',
          periodStart: new Date(),
          workingDaysConfig: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
          isCurrent: true
        }
      });
    }

    return ctx;
  }

  static async listContexts(db: any, tenantId: string, userId: string) {
    return db.hccallOrgContext.findMany({
      where: { tenantId, userId },
      orderBy: { periodStart: 'desc' }
    });
  }

  static async switchContext(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      companyName: string;
      workplace: string;
      jobRole: string;
      operationType?: string;
      businessArea?: string;
      workingDaysConfig?: any;
    }
  ) {
    // 1. Fechar o contexto atual
    const now = new Date();
    await db.hccallOrgContext.updateMany({
      where: { tenantId, userId, isCurrent: true },
      data: { isCurrent: false, periodEnd: now }
    });

    // 2. Criar o novo registo de contexto historizado
    const newContext = await db.hccallOrgContext.create({
      data: {
        tenantId,
        userId,
        companyName: data.companyName,
        workplace: data.workplace,
        jobRole: data.jobRole,
        operationType: data.operationType || 'CALL_CENTER',
        businessArea: data.businessArea || 'TELECOM',
        periodStart: now,
        workingDaysConfig: data.workingDaysConfig || { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
        isCurrent: true
      }
    });

    return newContext;
  }
}
