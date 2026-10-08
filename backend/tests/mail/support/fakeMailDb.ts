// Base de dados em memória com o subconjunto de Prisma que o TenantMailService usa.
// Aplica o filtro por tenantId tal como o tenantScopedClient faria.

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

function matches(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where || {})) {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('gte' in (cond as any) && !(row[key] >= (cond as any).gte)) return false;
    } else if (row[key] !== cond) {
      return false;
    }
  }
  return true;
}

export function createFakeMailDb() {
  const settings: any[] = [];
  const logs: any[] = [];

  return {
    __settings: settings,
    __logs: logs,
    tenantEmailSettings: {
      async findUnique({ where }: any) {
        return settings.find((r) => matches(r, where)) ?? null;
      },
      async upsert({ where, create, update }: any) {
        const existing = settings.find((r) => matches(r, where));
        const now = new Date();
        if (existing) {
          Object.assign(existing, update, { updatedAt: now });
          return { ...existing };
        }
        const row = {
          id: nextId('tes'),
          provider: 'PLATFORM',
          smtpSecure: true,
          dailyLimit: 300,
          isVerified: false,
          createdAt: now,
          updatedAt: now,
          ...create
        };
        settings.push(row);
        return { ...row };
      },
      async update({ where, data }: any) {
        const existing = settings.find((r) => matches(r, where));
        if (!existing) throw new Error('Record not found');
        Object.assign(existing, data, { updatedAt: new Date() });
        return { ...existing };
      }
    },
    emailSendLog: {
      async create({ data }: any) {
        const row = { id: nextId('log'), createdAt: new Date(), ...data };
        logs.push(row);
        return row;
      },
      async count({ where }: any) {
        return logs.filter((r) => matches(r, where)).length;
      },
      async findMany({ where, take }: any) {
        return logs.filter((r) => matches(r, where)).slice(-(take || 50)).reverse();
      }
    }
  };
}
