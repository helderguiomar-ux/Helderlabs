// Prisma "fake" em memória — implementa apenas o subconjunto de operações
// que o EnterpriseCRMService usa (lead, opportunity, customer, communication).
// Objetivo: testar a lógica de negócio do CRM sem precisar de uma base de
// dados Postgres real nem de correr `prisma generate` — útil em CI ou em
// ambientes sem acesso à rede que o Prisma precisa para descarregar os
// motores nativos.

let counter = 0;
function fakeId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function createFakePrismaClient() {
  const leads: any[] = [];
  const opportunities: any[] = [];
  const customers: any[] = [];
  const contacts: any[] = [];
  const communications: any[] = [];
  const companies: any[] = [];

  const db = {
    // --- helpers só para preparar cenários de teste ---
    __seed: {
      leads,
      opportunities,
      customers,
      contacts,
      communications,
      companies
    },

    company: {
      findFirst: async ({ where }: any = {}) =>
        companies.find((c) => (!where?.id || c.id === where.id) && (!where?.tenantId || c.tenantId === where.tenantId)) ?? null,
      create: async ({ data }: any) => {
        const comp = { id: fakeId('comp'), ...data };
        companies.push(comp);
        return comp;
      },
      update: async ({ where, data }: any) => {
        const comp = companies.find((c) => c.id === where.id);
        if (comp) Object.assign(comp, data);
        return comp;
      },
      findMany: async ({ where }: any = {}) =>
        companies.filter((c) => !where?.tenantId || c.tenantId === where.tenantId)
    },

    lead: {
      create: async ({ data }: any) => {
        const lead = { id: fakeId('lead'), createdAt: new Date(), ...data };
        leads.push(lead);
        return lead;
      },
      findUnique: async ({ where }: any) =>
        leads.find((l) => l.id === where.id && (!where.tenantId || l.tenantId === where.tenantId)) ?? null,
      findFirst: async ({ where }: any) =>
        leads.find((l) => (!where?.id || l.id === where.id) && (!where?.tenantId || l.tenantId === where.tenantId) && (where?.deletedAt === undefined || (where.deletedAt === null && !l.deletedAt))) ?? null,
      update: async ({ where, data }: any) => {
        const lead = leads.find((l) => l.id === where.id);
        if (!lead) throw new Error(`Lead ${where.id} não existe no fake client.`);
        Object.assign(lead, data);
        return lead;
      },
      findMany: async ({ where }: any = {}) =>
        leads.filter((l) => !where?.tenantId || l.tenantId === where.tenantId)
    },

    opportunity: {
      create: async ({ data }: any) => {
        const opportunity = { id: fakeId('opp'), ...data };
        opportunities.push(opportunity);
        return opportunity;
      },
      findUnique: async ({ where, include }: any) => {
        const opportunity = opportunities.find(
          (o) => o.id === where.id && (!where.tenantId || o.tenantId === where.tenantId)
        );
        if (!opportunity) return null;
        if (include?.lead) {
          const lead = leads.find((l) => l.id === opportunity.leadId) ?? null;
          return { ...opportunity, lead };
        }
        return opportunity;
      },
      findFirst: async ({ where, include }: any) => {
        const opportunity = opportunities.find(
          (o) => (!where?.id || o.id === where.id) && (!where?.tenantId || o.tenantId === where.tenantId) && (where?.deletedAt === undefined || (where.deletedAt === null && !o.deletedAt))
        );
        if (!opportunity) return null;
        if (include?.lead) {
          const lead = leads.find((l) => l.id === opportunity.leadId) ?? null;
          return { ...opportunity, lead };
        }
        return opportunity;
      },
      update: async ({ where, data }: any) => {
        const opportunity = opportunities.find((o) => o.id === where.id);
        if (!opportunity) throw new Error(`Opportunity ${where.id} não existe no fake client.`);
        Object.assign(opportunity, data);
        return opportunity;
      },
      findMany: async ({ where }: any = {}) =>
        opportunities.filter((o) => !where?.tenantId || o.tenantId === where.tenantId)
    },

    customer: {
      create: async ({ data }: any) => {
        const { contacts: contactsInput, ...rest } = data;
        const customer = { id: fakeId('cust'), ...rest };
        customers.push(customer);
        if (contactsInput?.create) {
          contacts.push({ id: fakeId('contact'), customerId: customer.id, ...contactsInput.create });
        }
        return customer;
      },
      findMany: async ({ where }: any = {}) =>
        customers.filter((c) => !where?.tenantId || c.tenantId === where.tenantId)
    },

    communication: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        communications.forEach((c) => {
          if (!where?.leadId || c.leadId === where.leadId) {
            Object.assign(c, data);
            count += 1;
          }
        });
        return { count };
      }
    },

    company: {
      create: async ({ data }: any) => {
        const company = { id: fakeId('comp'), createdAt: new Date(), ...data };
        return company;
      },
      findMany: async ({ where }: any = {}) => []
    }
  };

  return db;
}
