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
  const proposals: any[] = [];
  const proposalItems: any[] = [];
  const contracts: any[] = [];
  const companyDocuments: any[] = [];
  const accountEntries: any[] = [];
  const accountAllocations: any[] = [];

  const db = {
    // --- helpers só para preparar cenários de teste ---
    __seed: {
      leads,
      opportunities,
      customers,
      contacts,
      communications,
      companies,
      proposals,
      proposalItems,
      contracts,
      companyDocuments,
      accountEntries,
      accountAllocations
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

    companyContact: {
      findFirst: async ({ where, include }: any = {}) => {
        const c = contacts.find((item) => (!where?.id || item.id === where.id) && (where?.deletedAt === undefined || (where.deletedAt === null && !item.deletedAt))) ?? null;
        if (!c) return null;
        const res = { ...c };
        if (include?.company) {
          res.company = companies.find((comp) => comp.id === c.companyId) ?? null;
        }
        return res;
      },
      create: async ({ data }: any) => {
        const c = { id: fakeId('cont'), createdAt: new Date(), ...data };
        contacts.push(c);
        return c;
      }
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
      create: async ({ data }: any) => {
        const comm = { id: fakeId('comm'), createdAt: new Date(), occurredAt: new Date(), ...data };
        communications.push(comm);
        return comm;
      },
      findFirst: async ({ where, include }: any = {}) => {
        const comm = communications.find(
          (c) =>
            (!where?.id || c.id === where.id) &&
            (!where?.tenantId || c.tenantId === where.tenantId) &&
            (where?.deletedAt === undefined || (where.deletedAt === null && !c.deletedAt))
        );
        if (!comm) return null;
        const res = { ...comm };
        if (include?.company) res.company = companies.find((comp) => comp.id === comm.companyId) ?? null;
        if (include?.contact) res.contact = contacts.find((cont) => cont.id === comm.contactId) ?? null;
        if (include?.opportunity) res.opportunity = opportunities.find((opp) => opp.id === comm.opportunityId) ?? null;
        if (include?.lead) res.lead = leads.find((l) => l.id === comm.leadId) ?? null;
        return res;
      },
      findMany: async ({ where, include, orderBy, take }: any = {}) => {
        let items = communications.filter(
          (c) =>
            (!where?.tenantId || c.tenantId === where.tenantId) &&
            (!where?.companyId || c.companyId === where.companyId) &&
            (!where?.opportunityId || c.opportunityId === where.opportunityId) &&
            (!where?.contactId || c.contactId === where.contactId) &&
            (!where?.leadId || c.leadId === where.leadId) &&
            (!where?.status || c.status === where.status) &&
            (!where?.type || c.type === where.type) &&
            (where?.deletedAt === undefined || (where.deletedAt === null && !c.deletedAt))
        );

        if (where?.dueDate?.lt) {
          items = items.filter((c) => c.dueDate && new Date(c.dueDate) < where.dueDate.lt);
        }

        const res = items.map((comm) => {
          const item = { ...comm };
          if (include?.company) item.company = companies.find((comp) => comp.id === comm.companyId) ?? null;
          if (include?.contact) item.contact = contacts.find((cont) => cont.id === comm.contactId) ?? null;
          if (include?.opportunity) item.opportunity = opportunities.find((opp) => opp.id === comm.opportunityId) ?? null;
          if (include?.lead) item.lead = leads.find((l) => l.id === comm.leadId) ?? null;
          return item;
        });

        if (take) return res.slice(0, take);
        return res;
      },
      update: async ({ where, data }: any) => {
        const comm = communications.find((c) => c.id === where.id);
        if (!comm) throw new Error(`Communication ${where.id} não encontrada`);
        Object.assign(comm, data);
        return comm;
      },
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

    proposal: {
      count: async ({ where }: any = {}) => {
        return proposals.filter((p) => {
          if (where?.tenantId && p.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && p.deletedAt) return false;
          if (where?.status && p.status !== where.status) return false;
          if (where?.companyId && p.companyId !== where.companyId) return false;
          if (where?.opportunityId && p.opportunityId !== where.opportunityId) return false;
          return true;
        }).length;
      },
      findFirst: async ({ where, include }: any = {}) => {
        const p = proposals.find((item) => {
          if (where?.id && item.id !== where.id) return false;
          if (where?.tenantId && item.tenantId !== where.tenantId) return false;
          if (where?.proposalNumber && item.proposalNumber !== where.proposalNumber) return false;
          if (where?.deletedAt === null && item.deletedAt) return false;
          return true;
        });
        if (!p) return null;
        const res = { ...p };
        if (include?.items) {
          res.items = proposalItems.filter((it) => it.proposalId === p.id);
        }
        if (include?.company) res.company = companies.find((comp) => comp.id === p.companyId) ?? null;
        if (include?.contact) res.contact = contacts.find((cont) => cont.id === p.contactId) ?? null;
        if (include?.opportunity) res.opportunity = opportunities.find((opp) => opp.id === p.opportunityId) ?? null;
        return res;
      },
      findMany: async ({ where, include, orderBy, skip, take }: any = {}) => {
        let items = proposals.filter((p) => {
          if (where?.tenantId && p.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && p.deletedAt) return false;
          if (where?.status && p.status !== where.status) return false;
          if (where?.companyId && p.companyId !== where.companyId) return false;
          if (where?.opportunityId && p.opportunityId !== where.opportunityId) return false;
          return true;
        });

        if (orderBy?.createdAt === 'desc') {
          items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        const res = items.map((p) => {
          const item = { ...p };
          if (include?.items) {
            item.items = proposalItems.filter((it) => it.proposalId === p.id);
          }
          if (include?.company) item.company = companies.find((comp) => comp.id === p.companyId) ?? null;
          if (include?.contact) item.contact = contacts.find((cont) => cont.id === p.contactId) ?? null;
          if (include?.opportunity) item.opportunity = opportunities.find((opp) => opp.id === p.opportunityId) ?? null;
          return item;
        });

        const start = skip || 0;
        const end = take ? start + take : undefined;
        return res.slice(start, end);
      },
      create: async ({ data, include }: any) => {
        const { items: itemsInput, ...rest } = data;
        const p = {
          id: fakeId('prop'),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...rest
        };
        proposals.push(p);

        if (itemsInput?.create) {
          itemsInput.create.forEach((it: any) => {
            proposalItems.push({
              id: fakeId('prop_item'),
              proposalId: p.id,
              createdAt: new Date(),
              ...it
            });
          });
        }

        const res = { ...p };
        if (include?.items) {
          res.items = proposalItems.filter((it) => it.proposalId === p.id);
        }
        if (include?.company) res.company = companies.find((comp) => comp.id === p.companyId) ?? null;
        if (include?.contact) res.contact = contacts.find((cont) => cont.id === p.contactId) ?? null;
        if (include?.opportunity) res.opportunity = opportunities.find((opp) => opp.id === p.opportunityId) ?? null;
        return res;
      },
      update: async ({ where, data, include }: any) => {
        const p = proposals.find((item) => item.id === where.id);
        if (!p) throw new Error(`Proposal ${where.id} não encontrada no fake client`);

        const { items: itemsInput, ...rest } = data;
        Object.assign(p, rest, { updatedAt: new Date() });

        if (itemsInput?.create) {
          itemsInput.create.forEach((it: any) => {
            proposalItems.push({
              id: fakeId('prop_item'),
              proposalId: p.id,
              createdAt: new Date(),
              ...it
            });
          });
        }

        const res = { ...p };
        if (include?.items) {
          res.items = proposalItems.filter((it) => it.proposalId === p.id);
        }
        if (include?.company) res.company = companies.find((comp) => comp.id === p.companyId) ?? null;
        if (include?.contact) res.contact = contacts.find((cont) => cont.id === p.contactId) ?? null;
        if (include?.opportunity) res.opportunity = opportunities.find((opp) => opp.id === p.opportunityId) ?? null;
        return res;
      },
      aggregate: async ({ where, _sum }: any = {}) => {
        const items = proposals.filter((p) => {
          if (where?.tenantId && p.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && p.deletedAt) return false;
          if (where?.status && p.status !== where.status) return false;
          return true;
        });
        const total = items.reduce((acc, curr) => acc + (curr.totalCents || 0), 0);
        return {
          _sum: {
            totalCents: total
          }
        };
      }
    },

    proposalItem: {
      create: async ({ data }: any) => {
        const item = { id: fakeId('prop_item'), createdAt: new Date(), ...data };
        proposalItems.push(item);
        return item;
      },
      createMany: async ({ data }: any) => {
        if (Array.isArray(data)) {
          data.forEach((it) => {
            proposalItems.push({ id: fakeId('prop_item'), createdAt: new Date(), ...it });
          });
          return { count: data.length };
        }
        return { count: 0 };
      },
      deleteMany: async ({ where }: any = {}) => {
        let count = 0;
        for (let i = proposalItems.length - 1; i >= 0; i--) {
          if (!where?.proposalId || proposalItems[i].proposalId === where.proposalId) {
            proposalItems.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async ({ where }: any = {}) => {
        return proposalItems.filter((it) => !where?.proposalId || it.proposalId === where.proposalId);
      }
    },

    contract: {
      count: async ({ where }: any = {}) => {
        return contracts.filter((c) => {
          if (where?.tenantId && c.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && c.deletedAt) return false;
          if (where?.companyId && c.companyId !== where.companyId) return false;
          if (where?.status && c.status !== where.status) return false;
          return true;
        }).length;
      },
      findFirst: async ({ where, include }: any = {}) => {
        const c = contracts.find((item) => {
          if (where?.id && item.id !== where.id) return false;
          if (where?.tenantId && item.tenantId !== where.tenantId) return false;
          if (where?.contractNumber && item.contractNumber !== where.contractNumber) return false;
          if (where?.deletedAt === null && item.deletedAt) return false;
          return true;
        });
        if (!c) return null;
        const res = { ...c };
        if (include?.company) res.company = companies.find((comp) => comp.id === c.companyId) ?? null;
        if (include?.proposal) res.proposal = proposals.find((p) => p.id === c.proposalId) ?? null;
        return res;
      },
      findMany: async ({ where, include, orderBy, skip, take }: any = {}) => {
        let items = contracts.filter((c) => {
          if (where?.tenantId && c.tenantId !== where.tenantId) return false;
          if (where?.deletedAt === null && c.deletedAt) return false;
          if (where?.companyId && c.companyId !== where.companyId) return false;
          if (where?.status && c.status !== where.status) return false;
          if (where?.autoRenew !== undefined && c.autoRenew !== where.autoRenew) return false;
          return true;
        });

        if (orderBy?.startDate === 'desc') {
          items.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        }

        const res = items.map((c) => {
          const item = { ...c };
          if (include?.company) item.company = companies.find((comp) => comp.id === c.companyId) ?? null;
          if (include?.proposal) item.proposal = proposals.find((p) => p.id === c.proposalId) ?? null;
          return item;
        });

        const start = skip || 0;
        const end = take ? start + take : undefined;
        return res.slice(start, end);
      },
      create: async ({ data, include }: any) => {
        const c = {
          id: fakeId('contract'),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          ...data
        };
        contracts.push(c);
        const res = { ...c };
        if (include?.company) res.company = companies.find((comp) => comp.id === c.companyId) ?? null;
        if (include?.proposal) res.proposal = proposals.find((p) => p.id === c.proposalId) ?? null;
        return res;
      },
      update: async ({ where, data, include }: any) => {
        const c = contracts.find((item) => item.id === where.id);
        if (!c) throw new Error(`Contract ${where.id} não encontrado no fake client`);
        Object.assign(c, data, { updatedAt: new Date() });
        const res = { ...c };
        if (include?.company) res.company = companies.find((comp) => comp.id === c.companyId) ?? null;
        if (include?.proposal) res.proposal = proposals.find((p) => p.id === c.proposalId) ?? null;
        return res;
      }
    },

    companyDocument: {
      findFirst: async ({ where, include }: any = {}) => {
        const item = companyDocuments.find((d) => {
          if (where?.id && d.id !== where.id) return false;
          if (where?.tenantId && d.tenantId !== where.tenantId) return false;
          if (where?.companyId && d.companyId !== where.companyId) return false;
          if (where?.deletedAt === null && d.deletedAt) return false;
          if (where?.company?.tenantId) {
            const comp = companies.find((c) => c.id === d.companyId);
            if (!comp || comp.tenantId !== where.company.tenantId) return false;
          }
          return true;
        });
        if (!item) return null;
        const res = { ...item };
        if (include?.company) {
          res.company = companies.find((c) => c.id === item.companyId) ?? null;
        }
        return res;
      },
      count: async ({ where }: any = {}) => {
        return companyDocuments.filter((d) => {
          if (where?.tenantId && d.tenantId !== where.tenantId) return false;
          if (where?.companyId && d.companyId !== where.companyId) return false;
          if (where?.deletedAt === null && d.deletedAt) return false;
          if (where?.status && d.status !== where.status) return false;
          if (where?.verificationStatus && d.verificationStatus !== where.verificationStatus) return false;
          if (where?.docType && d.docType !== where.docType) return false;
          return true;
        }).length;
      },
      findMany: async ({ where, orderBy, take, skip, include }: any = {}) => {
        let items = companyDocuments.filter((d) => {
          if (where?.tenantId && d.tenantId !== where.tenantId) return false;
          if (where?.companyId && d.companyId !== where.companyId) return false;
          if (where?.deletedAt === null && d.deletedAt) return false;
          if (where?.status && d.status !== where.status) return false;
          if (where?.verificationStatus && d.verificationStatus !== where.verificationStatus) return false;
          if (where?.docType && d.docType !== where.docType) return false;
          if (where?.company?.tenantId) {
            const comp = companies.find((c) => c.id === d.companyId);
            if (!comp || comp.tenantId !== where.company.tenantId) return false;
          }
          return true;
        });

        if (orderBy?.expiryDate === 'asc') {
          items.sort((a, b) => {
            if (!a.expiryDate) return 1;
            if (!b.expiryDate) return -1;
            return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
          });
        } else if (orderBy?.createdAt === 'desc') {
          items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }

        const res = items.map((d) => {
          const item = { ...d };
          if (include?.company) {
            item.company = companies.find((c) => c.id === d.companyId) ?? null;
          }
          return item;
        });

        const start = skip || 0;
        const end = take ? start + take : undefined;
        return res.slice(start, end);
      },
      create: async ({ data, include }: any) => {
        const d = {
          id: fakeId('doc'),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          status: 'VALID',
          verificationStatus: 'PENDING',
          ...data
        };
        companyDocuments.push(d);
        const res = { ...d };
        if (include?.company) {
          res.company = companies.find((c) => c.id === d.companyId) ?? null;
        }
        return res;
      },
      update: async ({ where, data, include }: any) => {
        const d = companyDocuments.find((item) => item.id === where.id);
        if (!d) throw new Error(`Documento ${where.id} não encontrado no fake client`);
        Object.assign(d, data, { updatedAt: new Date() });
        const res = { ...d };
        if (include?.company) {
          res.company = companies.find((c) => c.id === d.companyId) ?? null;
        }
        return res;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        companyDocuments.forEach((item) => {
          if (where?.id && item.id !== where.id) return;
          if (where?.companyId && item.companyId !== where.companyId) return;
          if (where?.tenantId && item.tenantId !== where.tenantId) return;
          Object.assign(item, data, { updatedAt: new Date() });
          count++;
        });
        return { count };
      }
    },

    crmAccountEntry: {
      findFirst: async ({ where, include }: any = {}) => {
        const item = accountEntries.find((e) => {
          if (where?.id && e.id !== where.id) return false;
          if (where?.tenantId && e.tenantId !== where.tenantId) return false;
          if (where?.companyId && e.companyId !== where.companyId) return false;
          return true;
        });
        if (!item) return null;
        const res = { ...item };
        if (include?.company) {
          res.company = companies.find((c) => c.id === item.companyId) ?? null;
        }
        if (include?.paymentAllocations) {
          res.paymentAllocations = accountAllocations.filter(
            (a) => a.paymentEntryId === item.id && (!include.paymentAllocations?.where?.isCancelled || a.isCancelled === false)
          );
        }
        if (include?.documentAllocations) {
          res.documentAllocations = accountAllocations.filter(
            (a) => a.documentEntryId === item.id && (!include.documentAllocations?.where?.isCancelled || a.isCancelled === false)
          );
        }
        if (include?.reversedEntry) {
          res.reversedEntry = accountEntries.find((e) => e.id === item.reversesEntryId) ?? null;
        }
        if (include?.reversals) {
          res.reversals = accountEntries.filter((e) => e.reversesEntryId === item.id);
        }
        return res;
      },
      findMany: async ({ where, include, orderBy }: any = {}) => {
        let items = accountEntries.filter((e) => {
          if (where?.tenantId && e.tenantId !== where.tenantId) return false;
          if (where?.companyId && e.companyId !== where.companyId) return false;
          if (where?.isReversed !== undefined && e.isReversed !== where.isReversed) return false;
          if (where?.type?.in && !where.type.in.includes(e.type)) return false;
          return true;
        });
        items.sort((a, b) => new Date(a.entryDate || a.createdAt).getTime() - new Date(b.entryDate || b.createdAt).getTime());
        return items.map((item) => {
          const res = { ...item };
          if (include?.paymentAllocations) {
            res.paymentAllocations = accountAllocations.filter(
              (a) => a.paymentEntryId === item.id && (!include.paymentAllocations?.where?.isCancelled || a.isCancelled === false)
            );
          }
          if (include?.documentAllocations) {
            res.documentAllocations = accountAllocations.filter(
              (a) => a.documentEntryId === item.id && (!include.documentAllocations?.where?.isCancelled || a.isCancelled === false)
            );
          }
          if (include?.reversedEntry) {
            res.reversedEntry = accountEntries.find((e) => e.id === item.reversesEntryId) ?? null;
          }
          if (include?.reversals) {
            res.reversals = accountEntries.filter((e) => e.reversesEntryId === item.id);
          }
          return res;
        });
      },
      create: async ({ data }: any) => {
        const entry = {
          id: fakeId('entry'),
          createdAt: new Date(),
          isReversed: false,
          reversedAt: null,
          ...data
        };
        accountEntries.push(entry);
        return { ...entry, paymentAllocations: [], documentAllocations: [], reversedEntry: null, reversals: [] };
      },
      update: async ({ where, data }: any) => {
        const entry = accountEntries.find((e) => e.id === where.id);
        if (!entry) throw new Error(`Lançamento ${where.id} não encontrado no fake client`);
        Object.assign(entry, data);
        return { ...entry };
      }
    },

    crmAccountAllocation: {
      findMany: async ({ where }: any = {}) => {
        return accountAllocations.filter((a) => {
          if (where?.tenantId && a.tenantId !== where.tenantId) return false;
          if (where?.companyId && a.companyId !== where.companyId) return false;
          if (where?.isCancelled !== undefined && a.isCancelled !== where.isCancelled) return false;
          return true;
        });
      },
      create: async ({ data }: any) => {
        const alloc = {
          id: fakeId('alloc'),
          createdAt: new Date(),
          isCancelled: false,
          cancelledAt: null,
          ...data
        };
        accountAllocations.push(alloc);
        return alloc;
      },
      update: async ({ where, data }: any) => {
        const alloc = accountAllocations.find((a) => a.id === where.id);
        if (!alloc) throw new Error(`Alocação ${where.id} não encontrada no fake client`);
        Object.assign(alloc, data);
        return { ...alloc };
      }
    }
  };

  return db;
}
