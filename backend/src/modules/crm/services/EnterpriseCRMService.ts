import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { prisma as defaultPrismaClient } from '../../../database/prisma/client';

export class EnterpriseCRMService {
  constructor(
    private readonly tenantId: string,
    private readonly db: TenantScopedPrismaClient | any = defaultPrismaClient
  ) {}

  // =========================================================================
  // COMPLETENESS SCORE CALCULATION
  // =========================================================================

  public static calculateCompleteness(company: any): number {
    let score = 0;
    if (company.tradeName) score += 10;
    if (company.legalName) score += 10;
    if (company.taxNumber) score += 15;
    if (company.email || company.phone) score += 10;
    if (company.address || company.city || company.postalCode) score += 10;
    if (company.sector || company.employeesCount) score += 10;
    if (company.contacts && company.contacts.length > 0) score += 15;
    if (company.ibanMasked || company.paymentMethod) score += 10;
    if ((company.documents && company.documents.length > 0) || (company.contracts && company.contracts.length > 0)) score += 10;
    return Math.min(100, score);
  }

  // =========================================================================
  // EMPRESA 360º CRUD & 360 VIEW
  // =========================================================================

  public async listCompanies(filters?: {
    status?: string;
    search?: string;
    sector?: string;
    includeDeleted?: boolean;
  }) {
    const where: any = {
      tenantId: this.tenantId
    };

    if (!filters?.includeDeleted) {
      where.deletedAt = null;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.sector) {
      where.sector = filters.sector;
    }

    if (filters?.search) {
      where.OR = [
        { tradeName: { contains: filters.search, mode: 'insensitive' } },
        { legalName: { contains: filters.search, mode: 'insensitive' } },
        { taxNumber: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } }
      ];
    }

    return this.db.company.findMany({
      where,
      include: {
        contacts: { where: { deletedAt: null } },
        contracts: { where: { deletedAt: null } },
        _count: {
          select: {
            contacts: true,
            contracts: true,
            documents: true,
            transactions: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  public async getCompany360(id: string) {
    const company = await this.db.company.findUnique({
      where: { id, tenantId: this.tenantId } as any,
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
        addresses: { where: { deletedAt: null } },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        contracts: { where: { deletedAt: null }, orderBy: { startDate: 'desc' } },
        fromRelations: { include: { toCompany: true } },
        toRelations: { include: { fromCompany: true } },
        transactions: { where: { deletedAt: null }, orderBy: { dueDate: 'desc' }, take: 20 },
        assignedUser: { select: { id: true, name: true, email: true } }
      }
    });

    if (!company) {
      throw new Error('Empresa não encontrada.');
    }

    // Dynamic completeness score
    const completeness = EnterpriseCRMService.calculateCompleteness(company);

    return {
      ...company,
      completenessPercent: completeness
    };
  }

  public async createCompany(data: {
    tradeName: string;
    legalName?: string;
    taxNumber?: string;
    entityType?: string;
    status?: any;
    country?: string;
    district?: string;
    city?: string;
    postalCode?: string;
    address?: string;
    website?: string;
    email?: string;
    phone?: string;
    sector?: string;
    employeesCount?: number;
    annualRevenueCents?: number | bigint;
    originSource?: string;
    assignedUserId?: string;
    creditLimitCents?: number | bigint;
    paymentTermsDays?: number;
    paymentMethod?: string;
    ibanMasked?: string;
    vatScheme?: string;
    tags?: string[];
    notes?: string;
    riskScore?: string;
  }) {
    const completeness = EnterpriseCRMService.calculateCompleteness(data);

    return this.db.company.create({
      data: {
        tenantId: this.tenantId,
        tradeName: data.tradeName,
        legalName: data.legalName || null,
        taxNumber: data.taxNumber || null,
        entityType: data.entityType || 'LDA',
        status: data.status || 'LEAD',
        country: data.country || 'Portugal',
        district: data.district || null,
        city: data.city || null,
        postalCode: data.postalCode || null,
        address: data.address || null,
        website: data.website || null,
        email: data.email || null,
        phone: data.phone || null,
        sector: data.sector || null,
        employeesCount: data.employeesCount || null,
        annualRevenueCents: data.annualRevenueCents || null,
        originSource: data.originSource || null,
        assignedUserId: data.assignedUserId || null,
        creditLimitCents: data.creditLimitCents || null,
        paymentTermsDays: data.paymentTermsDays || 30,
        paymentMethod: data.paymentMethod || 'TRANSFER',
        ibanMasked: data.ibanMasked || null,
        vatScheme: data.vatScheme || 'NORMAL',
        tags: data.tags || [],
        notes: data.notes || null,
        riskScore: data.riskScore || 'BAIXO',
        completenessPercent: completeness
      }
    });
  }

  public async updateCompany(id: string, data: any) {
    const existing = await this.db.company.findUnique({
      where: { id, tenantId: this.tenantId } as any,
      include: { contacts: true, documents: true, contracts: true }
    });
    if (!existing) throw new Error('Empresa não encontrada.');

    const merged = { ...existing, ...data };
    const completeness = EnterpriseCRMService.calculateCompleteness(merged);

    return this.db.company.update({
      where: { id, tenantId: this.tenantId } as any,
      data: {
        ...data,
        completenessPercent: completeness
      }
    });
  }

  public async deleteCompany(id: string) {
    return this.db.company.update({
      where: { id, tenantId: this.tenantId } as any,
      data: { deletedAt: new Date() }
    });
  }

  public async restoreCompany(id: string) {
    return this.db.company.update({
      where: { id, tenantId: this.tenantId } as any,
      data: { deletedAt: null }
    });
  }

  // =========================================================================
  // CONTACTOS DA EMPRESA
  // =========================================================================

  public async addCompanyContact(companyId: string, data: {
    name: string;
    role?: string;
    department?: string;
    email?: string;
    phone?: string;
    mobile?: string;
    isPrimary?: boolean;
    decisionPower?: string;
    notes?: string;
  }) {
    if (data.isPrimary) {
      await this.db.companyContact.updateMany({
        where: { companyId },
        data: { isPrimary: false }
      });
    }

    return this.db.companyContact.create({
      data: {
        companyId,
        name: data.name,
        role: data.role || null,
        department: data.department || null,
        email: data.email || null,
        phone: data.phone || null,
        mobile: data.mobile || null,
        isPrimary: data.isPrimary || false,
        decisionPower: data.decisionPower || 'INFLUENCER',
        notes: data.notes || null
      }
    });
  }

  public async updateCompanyContact(contactId: string, data: any) {
    if (data.isPrimary) {
      const contact = await this.db.companyContact.findUnique({ where: { id: contactId } });
      if (contact) {
        await this.db.companyContact.updateMany({
          where: { companyId: contact.companyId, id: { not: contactId } },
          data: { isPrimary: false }
        });
      }
    }

    return this.db.companyContact.update({
      where: { id: contactId },
      data
    });
  }

  public async deleteCompanyContact(contactId: string) {
    return this.db.companyContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // ENDEREÇOS DA EMPRESA
  // =========================================================================

  public async addCompanyAddress(companyId: string, data: {
    type?: string;
    street: string;
    city?: string;
    district?: string;
    postalCode?: string;
    country?: string;
    isDefault?: boolean;
  }) {
    if (data.isDefault) {
      await this.db.companyAddress.updateMany({
        where: { companyId },
        data: { isDefault: false }
      });
    }

    return this.db.companyAddress.create({
      data: {
        companyId,
        type: data.type || 'HQ',
        street: data.street,
        city: data.city || null,
        district: data.district || null,
        postalCode: data.postalCode || null,
        country: data.country || 'Portugal',
        isDefault: data.isDefault || false
      }
    });
  }

  public async deleteCompanyAddress(addressId: string) {
    return this.db.companyAddress.update({
      where: { id: addressId },
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // DOCUMENTOS & CONTRATOS
  // =========================================================================

  public async addCompanyDocument(companyId: string, data: {
    name: string;
    category?: string;
    fileUrl: string;
    fileType?: string;
    size?: number;
    expiresAt?: Date | string;
  }) {
    return this.db.companyDocument.create({
      data: {
        companyId,
        name: data.name,
        category: data.category || 'OTHER',
        fileUrl: data.fileUrl,
        fileType: data.fileType || null,
        size: data.size || null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null
      }
    });
  }

  public async deleteCompanyDocument(docId: string) {
    return this.db.companyDocument.update({
      where: { id: docId },
      data: { deletedAt: new Date() }
    });
  }

  public async listContracts(companyId?: string) {
    const where: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };
    if (companyId) where.companyId = companyId;

    return this.db.contract.findMany({
      where,
      include: { company: true },
      orderBy: { startDate: 'desc' }
    });
  }

  public async createContract(companyId: string, data: {
    contractNumber: string;
    title: string;
    status?: string;
    monthlyValueCents?: number;
    annualValueCents?: number;
    totalValueCents?: number;
    startDate: Date | string;
    endDate?: Date | string;
    renewalType?: string;
    noticePeriodDays?: number;
    documentUrl?: string;
    terms?: string;
  }) {
    return this.db.contract.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        contractNumber: data.contractNumber,
        title: data.title,
        status: data.status || 'ACTIVE',
        monthlyValueCents: data.monthlyValueCents || null,
        annualValueCents: data.annualValueCents || null,
        totalValueCents: data.totalValueCents || null,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        renewalType: data.renewalType || 'MANUAL',
        noticePeriodDays: data.noticePeriodDays || 30,
        documentUrl: data.documentUrl || null,
        terms: data.terms || null
      }
    });
  }

  public async updateContract(contractId: string, data: any) {
    return this.db.contract.update({
      where: { id: contractId, tenantId: this.tenantId } as any,
      data: {
        ...data,
        ...(data.startDate && { startDate: new Date(data.startDate) }),
        ...(data.endDate && { endDate: new Date(data.endDate) })
      }
    });
  }

  public async deleteContract(contractId: string) {
    return this.db.contract.update({
      where: { id: contractId, tenantId: this.tenantId } as any,
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // RELAÇÕES SOCIETÁRIAS (ÁRVORE DO GRUPO)
  // =========================================================================

  public async addCompanyRelation(fromCompanyId: string, toCompanyId: string, relationType: string, notes?: string) {
    return this.db.companyRelation.create({
      data: {
        fromCompanyId,
        toCompanyId,
        relationType,
        notes: notes || null
      }
    });
  }

  public async deleteCompanyRelation(relationId: string) {
    return this.db.companyRelation.delete({
      where: { id: relationId }
    });
  }

  // =========================================================================
  // LEGACY LEADS & OPPORTUNITIES PIPELINE (100% COMPATÍVEL & PRESERVADO)
  // =========================================================================

  public async convertLeadToOpportunity(leadId: string, estimatedValue: number) {
    const lead = await this.db.lead.findUnique({ where: { id: leadId, tenantId: this.tenantId } as any });
    if (!lead) throw new Error('Lead não encontrada.');

    await this.db.lead.update({
      where: { id: leadId },
      data: { status: 'QUALIFICATION' }
    });

    const opportunity = await this.db.opportunity.create({
      data: {
        title: `Oportunidade Comercial - ${lead.company}`,
        leadId: lead.id,
        stage: 'QUALIFICATION',
        estimatedValue,
        probability: 20,
        tenantId: this.tenantId,
        assignedUserId: lead.assignedUserId
      }
    });

    return opportunity;
  }

  public async winOpportunityAndCreateCustomer(opportunityId: string) {
    const opp = await this.db.opportunity.findUnique({
      where: { id: opportunityId, tenantId: this.tenantId } as any,
      include: { lead: true }
    });

    if (!opp) throw new Error('Oportunidade não encontrada.');

    const customer = await this.db.customer.create({
      data: {
        tenantId: this.tenantId,
        companyName: opp.lead ? opp.lead.company : opp.title,
        website: opp.lead ? opp.lead.website : null,
        assignedUserId: opp.assignedUserId,
        contacts: opp.lead
          ? {
              create: {
                name: opp.lead.name,
                email: opp.lead.email,
                phone: opp.lead.phone || opp.lead.mobile || null,
                role: opp.lead.role || 'Contacto Principal',
                isPrimary: true
              }
            }
          : undefined
      }
    });

    await this.db.opportunity.update({
      where: { id: opportunityId },
      data: {
        stage: 'WON',
        customerId: customer.id
      }
    });

    if (opp.leadId) {
      await this.db.communication.updateMany({
        where: { leadId: opp.leadId },
        data: { customerId: customer.id }
      });
    }

    return customer;
  }

  public async createLead(data: {
    company: string;
    name: string;
    email?: string;
    phone?: string;
    source: string;
  }) {
    return this.db.lead.create({
      data: {
        tenantId: this.tenantId,
        company: data.company,
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        source: data.source,
        status: 'NEW'
      }
    });
  }

  public static async createPublicLead(data: {
    company?: string;
    name: string;
    email?: string;
    phone?: string;
    sector?: string;
    message?: string;
  }) {
    let platformTenant = await defaultPrismaClient.tenant.findFirst({
      where: { slug: 'helderlabs-platform' }
    });
    if (!platformTenant) {
      platformTenant = await defaultPrismaClient.tenant.findFirst();
    }
    const tenantId = platformTenant ? platformTenant.id : 'helderlabs-platform';

    return defaultPrismaClient.lead.create({
      data: {
        tenantId,
        company: data.company || 'Pessoa Singular',
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        source: data.sector ? `landing_diagnostico_${data.sector}` : 'landing_diagnostico',
        status: 'NEW'
      }
    });
  }

  public async listLeads() {
    return this.db.lead.findMany({ where: { tenantId: this.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  public async updateLead(id: string, data: Partial<{ company: string; name: string; email: string; phone: string; source: string; status: string }>) {
    return this.db.lead.update({
      where: { id, tenantId: this.tenantId },
      data: data as any
    });
  }

  public async deleteLead(id: string) {
    return this.db.lead.delete({
      where: { id, tenantId: this.tenantId }
    });
  }

  public async listOpportunities() {
    return this.db.opportunity.findMany({ where: { tenantId: this.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  public async listCustomers() {
    return this.db.customer.findMany({ where: { tenantId: this.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  public async getAdvancedDashboardMetrics() {
    const [leads, opportunities, customers, companies] = await Promise.all([
      this.db.lead.findMany({ where: { tenantId: this.tenantId } }),
      this.db.opportunity.findMany({ where: { tenantId: this.tenantId } }),
      this.db.customer.findMany({ where: { tenantId: this.tenantId } }),
      this.db.company ? this.db.company.findMany({ where: { tenantId: this.tenantId, deletedAt: null } }) : Promise.resolve([])
    ]);

    const pipelineValue = opportunities
      .filter((o: any) => o.stage !== 'LOST')
      .reduce((sum: number, o: any) => sum + o.estimatedValue, 0);

    const expectedRevenue = opportunities
      .filter((o: any) => o.stage !== 'LOST')
      .reduce((sum: number, o: any) => sum + (o.estimatedValue * (o.probability / 100)), 0);

    const totalOpps = opportunities.length;
    const wonOpps = opportunities.filter((o: any) => o.stage === 'WON').length;
    const conversionRate = totalOpps > 0 ? ((wonOpps / totalOpps) * 100).toFixed(1) + '%' : '0%';

    const leadsBySource: Record<string, number> = {};
    leads.forEach((l: any) => {
      leadsBySource[l.source] = (leadsBySource[l.source] || 0) + 1;
    });

    return {
      pipelineValue,
      expectedRevenue,
      totalLeads: leads.length,
      totalCompanies: companies.length,
      activeOpportunities: opportunities.filter((o: any) => o.stage !== 'WON' && o.stage !== 'LOST').length,
      activeCustomers: customers.length,
      conversionRate,
      leadsBySource
    };
  }
}
