import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { prisma as defaultPrismaClient } from '../../../database/prisma/client';
import { AppError } from '../../../utils/errors';
import { AuditService } from '../../platform/services/AuditService';
import { normalizePhoneNumber } from '../utils/validators';

function notFound(message = 'Registo não encontrado.') {
  return new AppError('NOT_FOUND', message, 404);
}

export class EnterpriseCRMService {
  constructor(
    private readonly tenantId: string,
    private readonly db: TenantScopedPrismaClient | any = defaultPrismaClient
  ) {}

  // =========================================================================
  // VERIFICAÇÕES DE POSSE DE TENANT (ISOLAMENTO SEGURO — 404 NOT FOUND)
  // =========================================================================

  public async assertCompanyOwned(companyId: string) {
    const company = await this.db.company.findFirst({
      where: { id: companyId, tenantId: this.tenantId, deletedAt: null }
    });
    if (!company) {
      throw notFound('Empresa não encontrada.');
    }
    return company;
  }

  public async assertContactOwned(contactId: string) {
    const contact = await this.db.companyContact.findFirst({
      where: { id: contactId, deletedAt: null },
      include: { company: true }
    });
    if (!contact || contact.company.tenantId !== this.tenantId || contact.company.deletedAt !== null) {
      throw notFound('Contacto não encontrado.');
    }
    return contact;
  }

  public async assertAddressOwned(addressId: string) {
    const address = await this.db.companyAddress.findFirst({
      where: { id: addressId, deletedAt: null },
      include: { company: true }
    });
    if (!address || address.company.tenantId !== this.tenantId || address.company.deletedAt !== null) {
      throw notFound('Endereço não encontrado.');
    }
    return address;
  }

  public async assertDocumentOwned(docId: string) {
    const doc = await this.db.companyDocument.findFirst({
      where: { id: docId, deletedAt: null },
      include: { company: true }
    });
    if (!doc || doc.company.tenantId !== this.tenantId || doc.company.deletedAt !== null) {
      throw notFound('Documento não encontrado.');
    }
    return doc;
  }

  public async assertContractOwned(contractId: string) {
    const contract = await this.db.contract.findFirst({
      where: { id: contractId, tenantId: this.tenantId, deletedAt: null },
      include: { company: true }
    });
    if (!contract || contract.company.tenantId !== this.tenantId || contract.company.deletedAt !== null) {
      throw notFound('Contrato não encontrado.');
    }
    return contract;
  }

  public async assertRelationOwned(relationId: string) {
    const relation = await this.db.companyRelation.findFirst({
      where: { id: relationId, deletedAt: null },
      include: { fromCompany: true, toCompany: true }
    });
    if (
      !relation ||
      relation.fromCompany.tenantId !== this.tenantId ||
      relation.fromCompany.deletedAt !== null ||
      relation.toCompany.tenantId !== this.tenantId ||
      relation.toCompany.deletedAt !== null
    ) {
      throw notFound('Relação não encontrada.');
    }
    return relation;
  }

  public async assertLeadOwned(leadId: string) {
    const lead = await this.db.lead.findFirst({
      where: { id: leadId, tenantId: this.tenantId, deletedAt: null }
    });
    if (!lead) {
      throw notFound('Lead não encontrada.');
    }
    return lead;
  }

  public async assertOpportunityOwned(oppId: string) {
    const opp = await this.db.opportunity.findFirst({
      where: { id: oppId, tenantId: this.tenantId, deletedAt: null },
      include: { lead: true, company: true, contact: true, customer: true }
    });
    if (!opp) {
      throw notFound('Oportunidade não encontrada.');
    }
    return opp;
  }

  // =========================================================================
  // CÁLCULO DE COMPLETUDE DA FICHA 360º
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
  // EMPRESAS 360º (PAGINAÇÃO, BUSCA E CRUD SEGURO)
  // =========================================================================

  public async listCompanies(filters?: {
    status?: string;
    search?: string;
    sector?: string;
    ownerUserId?: string;
    limit?: number;
    cursor?: string;
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

    if (filters?.ownerUserId) {
      where.assignedUserId = filters.ownerUserId;
    }

    if (filters?.search) {
      const s = filters.search.trim();
      where.OR = [
        { tradeName: { contains: s, mode: 'insensitive' } },
        { legalName: { contains: s, mode: 'insensitive' } },
        { taxNumber: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } }
      ];
    }

    const limit = Math.min(Math.max(Number(filters?.limit) || 20, 1), 100);
    const cursor = filters?.cursor ? { id: filters.cursor } : undefined;

    const [total, items] = await Promise.all([
      this.db.company.count({ where }),
      this.db.company.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { skip: 1, cursor } : {}),
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
      })
    ]);

    let nextCursor: string | null = null;
    let companies = items;
    if (items.length > limit) {
      const nextItem = items.pop();
      nextCursor = nextItem ? nextItem.id : null;
      companies = items;
    }

    return {
      companies,
      nextCursor,
      total
    };
  }

  public async getCompaniesMetrics() {
    const [statusGroups, total] = await Promise.all([
      this.db.company.groupBy({
        by: ['status'],
        where: { tenantId: this.tenantId, deletedAt: null },
        _count: { _all: true }
      }),
      this.db.company.count({
        where: { tenantId: this.tenantId, deletedAt: null }
      })
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) {
      byStatus[g.status] = g._count._all;
    }

    return {
      total,
      leads: (byStatus['LEAD'] || 0) + (byStatus['POTENTIAL'] || 0),
      customers: byStatus['CUSTOMER'] || 0,
      suppliers: (byStatus['SUPPLIER'] || 0) + (byStatus['PARTNER'] || 0),
      byStatus
    };
  }

  public async getCompany360(id: string) {
    await this.assertCompanyOwned(id);

    const company = await this.db.company.findUnique({
      where: { id, tenantId: this.tenantId } as any,
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
        addresses: { where: { deletedAt: null } },
        documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        contracts: { where: { deletedAt: null }, orderBy: { startDate: 'desc' } },
        fromRelations: { where: { deletedAt: null }, include: { toCompany: true } },
        toRelations: { where: { deletedAt: null }, include: { fromCompany: true } },
        transactions: { where: { deletedAt: null }, orderBy: { dueDate: 'desc' }, take: 20 },
        assignedUser: { select: { id: true, name: true, email: true } }
      }
    });

    if (!company) {
      throw notFound('Empresa não encontrada.');
    }

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
    force?: boolean;
  }) {
    // Verificação de duplicados no mesmo tenant
    if (!data.force) {
      const duplicateConditions: any[] = [];
      if (data.taxNumber && data.taxNumber.trim()) {
        duplicateConditions.push({ taxNumber: data.taxNumber.trim() });
      }
      if (data.email && data.email.trim()) {
        duplicateConditions.push({ email: { equals: data.email.trim(), mode: 'insensitive' } });
      }

      if (duplicateConditions.length > 0) {
        const existing = await this.db.company.findFirst({
          where: {
            tenantId: this.tenantId,
            deletedAt: null,
            OR: duplicateConditions
          }
        });

        if (existing) {
          throw new AppError(
            'DUPLICATE_COMPANY',
            'Já existe uma empresa com este NIF ou email registada.',
            409,
            { existingCompanyId: existing.id }
          );
        }
      }
    } else {
      // Registo de auditoria para criação forçada de duplicado
      await AuditService.audit({
        action: 'crm.company.force_create',
        module: 'crm',
        category: 'APPLICATION',
        resource: 'Company',
        description: `Criação de empresa com validação de duplicados contornada via force:true (${data.tradeName}, NIF: ${data.taxNumber || 'N/A'})`,
        tenantId: this.tenantId,
        actorType: 'USER'
      }).catch(() => undefined);
    }

    const completeness = EnterpriseCRMService.calculateCompleteness(data);

    return this.db.company.create({
      data: {
        tenantId: this.tenantId,
        tradeName: data.tradeName.trim(),
        legalName: data.legalName ? data.legalName.trim() : null,
        taxNumber: data.taxNumber ? data.taxNumber.trim() : null,
        entityType: data.entityType || 'LDA',
        status: data.status || 'LEAD',
        country: data.country || 'Portugal',
        district: data.district || null,
        city: data.city || null,
        postalCode: data.postalCode || null,
        address: data.address || null,
        website: data.website || null,
        email: data.email ? data.email.trim().toLowerCase() : null,
        phone: normalizePhoneNumber(data.phone),
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
    const existing = await this.assertCompanyOwned(id);

    const merged = { ...existing, ...data };
    const completeness = EnterpriseCRMService.calculateCompleteness(merged);

    const updateData: any = { ...data, completenessPercent: completeness };
    if (updateData.phone) updateData.phone = normalizePhoneNumber(updateData.phone);
    if (updateData.email) updateData.email = updateData.email.trim().toLowerCase();
    if (updateData.taxNumber) updateData.taxNumber = updateData.taxNumber.trim();

    return this.db.company.update({
      where: { id },
      data: updateData
    });
  }

  public async deleteCompany(id: string) {
    await this.assertCompanyOwned(id);
    return this.db.company.update({
      where: { id },
      data: { deletedAt: new Date() }
    });
  }

  public async restoreCompany(id: string) {
    const existing = await this.db.company.findFirst({
      where: { id, tenantId: this.tenantId }
    });
    if (!existing) throw notFound('Empresa não encontrada.');

    return this.db.company.update({
      where: { id },
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
    decisionPower?: 'DECISOR' | 'INFLUENCIADOR' | 'UTILIZADOR' | 'OUTRO' | null;
    notes?: string;
  }) {
    await this.assertCompanyOwned(companyId);

    if (data.isPrimary) {
      await this.db.companyContact.updateMany({
        where: { companyId },
        data: { isPrimary: false }
      });
    }

    return this.db.companyContact.create({
      data: {
        companyId,
        name: data.name.trim(),
        role: data.role || null,
        department: data.department || null,
        email: data.email ? data.email.trim().toLowerCase() : null,
        phone: normalizePhoneNumber(data.phone),
        mobile: normalizePhoneNumber(data.mobile),
        isPrimary: data.isPrimary || false,
        decisionPower: data.decisionPower || null,
        notes: data.notes || null
      }
    });
  }

  public async updateCompanyContact(contactId: string, data: any) {
    const contact = await this.assertContactOwned(contactId);

    if (data.isPrimary) {
      await this.db.companyContact.updateMany({
        where: { companyId: contact.companyId, id: { not: contactId } },
        data: { isPrimary: false }
      });
    }

    const updateData: any = { ...data };
    if (updateData.phone) updateData.phone = normalizePhoneNumber(updateData.phone);
    if (updateData.mobile) updateData.mobile = normalizePhoneNumber(updateData.mobile);
    if (updateData.email) updateData.email = updateData.email.trim().toLowerCase();

    return this.db.companyContact.update({
      where: { id: contactId },
      data: updateData
    });
  }

  public async deleteCompanyContact(contactId: string) {
    await this.assertContactOwned(contactId);
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
    purpose?: string;
    street?: string;
    address?: string;
    city?: string;
    district?: string;
    postalCode?: string;
    country?: string;
    isDefault?: boolean;
  }) {
    await this.assertCompanyOwned(companyId);

    if (data.isDefault) {
      await this.db.companyAddress.updateMany({
        where: { companyId },
        data: { isDefault: false }
      });
    }

    return this.db.companyAddress.create({
      data: {
        companyId,
        purpose: data.purpose || data.type || 'SEDE',
        address: data.address || data.street || '',
        city: data.city || null,
        postalCode: data.postalCode || null,
        country: data.country || 'Portugal',
        isDefault: data.isDefault || false
      }
    });
  }

  public async deleteCompanyAddress(addressId: string) {
    await this.assertAddressOwned(addressId);
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
    docType?: string;
    fileUrl?: string;
    fileType?: string;
    size?: number;
    expiresAt?: Date | string;
    expiryDate?: Date | string;
  }) {
    await this.assertCompanyOwned(companyId);

    return this.db.companyDocument.create({
      data: {
        companyId,
        name: data.name,
        docType: data.docType || data.category || 'OTHER',
        fileUrl: data.fileUrl || null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : (data.expiresAt ? new Date(data.expiresAt) : null),
        status: 'VALID'
      }
    });
  }

  public async deleteCompanyDocument(docId: string) {
    await this.assertDocumentOwned(docId);
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
    if (companyId) {
      await this.assertCompanyOwned(companyId);
      where.companyId = companyId;
    }

    return this.db.contract.findMany({
      where,
      include: { company: true },
      orderBy: { startDate: 'desc' }
    });
  }

  public async createContract(companyId: string, data: {
    contractNumber: string;
    title: string;
    type?: string;
    status?: string;
    valueCents?: number;
    monthlyValueCents?: number;
    annualValueCents?: number;
    totalValueCents?: number;
    billingFrequency?: string;
    autoRenew?: boolean;
    startDate: Date | string;
    endDate?: Date | string;
    renewalType?: string;
    noticePeriodDays?: number;
    documentUrl?: string;
    terms?: string;
  }) {
    await this.assertCompanyOwned(companyId);

    const valueCents = data.valueCents ?? data.monthlyValueCents ?? data.annualValueCents ?? data.totalValueCents ?? 0;
    const autoRenew = data.autoRenew !== undefined ? data.autoRenew : (data.renewalType === 'AUTOMATIC' || data.renewalType === 'AUTO');
    return this.db.contract.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        contractNumber: data.contractNumber,
        title: data.title,
        type: data.type || 'SERVICE',
        status: data.status || 'ACTIVE',
        valueCents: Math.round(valueCents),
        billingFrequency: data.billingFrequency || (data.monthlyValueCents ? 'MONTHLY' : (data.annualValueCents ? 'ANNUAL' : 'ONE_OFF')),
        autoRenew,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        documentUrl: data.documentUrl || null
      }
    });
  }

  public async updateContract(contractId: string, data: any) {
    await this.assertContractOwned(contractId);

    const updateData: any = { ...data };
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
    if (updateData.monthlyValueCents !== undefined && updateData.valueCents === undefined) {
      updateData.valueCents = updateData.monthlyValueCents;
    }
    delete updateData.monthlyValueCents;
    delete updateData.annualValueCents;
    delete updateData.totalValueCents;
    delete updateData.renewalType;
    delete updateData.noticePeriodDays;
    delete updateData.terms;

    return this.db.contract.update({
      where: { id: contractId },
      data: updateData
    });
  }

  public async deleteContract(contractId: string) {
    await this.assertContractOwned(contractId);
    return this.db.contract.update({
      where: { id: contractId },
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // RELAÇÕES SOCIETÁRIAS (ÁRVORE DO GRUPO)
  // =========================================================================

  public async addCompanyRelation(fromCompanyId: string, toCompanyId: string, relationType: string, notes?: string) {
    await this.assertCompanyOwned(fromCompanyId);
    await this.assertCompanyOwned(toCompanyId);

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
    await this.assertRelationOwned(relationId);
    return this.db.companyRelation.update({
      where: { id: relationId },
      data: { deletedAt: new Date() }
    });
  }

  // =========================================================================
  // PIPELINE COMERCIAL, FUNIL KANBAN & OPORTUNIDADES (FASE B2)
  // =========================================================================

  public async getPipelineKanban(filters?: { assignedUserId?: string }) {
    const where: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };
    if (filters?.assignedUserId) {
      where.assignedUserId = filters.assignedUserId;
    }

    const opportunities = await this.db.opportunity.findMany({
      where,
      include: {
        company: {
          select: { id: true, tradeName: true, taxNumber: true, status: true, sector: true }
        },
        contact: {
          select: { id: true, name: true, phone: true, email: true, role: true, decisionPower: true }
        },
        lead: {
          select: { id: true, company: true, name: true, phone: true, email: true, source: true }
        },
        customer: {
          select: { id: true, companyName: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const columns: Record<string, { stage: string; label: string; defaultProbability: number; count: number; totalValue: number; weightedValue: number; opportunities: any[] }> = {
      QUALIFICATION: {
        stage: 'QUALIFICATION',
        label: 'Qualificação',
        defaultProbability: 20,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
        opportunities: []
      },
      PROPOSAL: {
        stage: 'PROPOSAL',
        label: 'Proposta Apresentada',
        defaultProbability: 50,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
        opportunities: []
      },
      NEGOTIATION: {
        stage: 'NEGOTIATION',
        label: 'Negociação & Fecho',
        defaultProbability: 80,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
        opportunities: []
      },
      WON: {
        stage: 'WON',
        label: 'Ganho / Fechado',
        defaultProbability: 100,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
        opportunities: []
      },
      LOST: {
        stage: 'LOST',
        label: 'Perdido',
        defaultProbability: 0,
        count: 0,
        totalValue: 0,
        weightedValue: 0,
        opportunities: []
      }
    };

    let totalPipelineValue = 0;
    let totalWeightedValue = 0;
    let wonValue = 0;

    for (const opp of opportunities) {
      const stageKey = opp.stage in columns ? opp.stage : 'QUALIFICATION';
      const col = columns[stageKey];
      col.count += 1;
      col.totalValue += opp.estimatedValue;
      const weighted = opp.estimatedValue * (opp.probability / 100);
      col.weightedValue += weighted;
      col.opportunities.push(opp);

      if (opp.stage !== 'LOST') {
        totalPipelineValue += opp.estimatedValue;
        totalWeightedValue += weighted;
      }
      if (opp.stage === 'WON') {
        wonValue += opp.estimatedValue;
      }
    }

    const wonCount = columns.WON.count;
    const lostCount = columns.LOST.count;
    const totalClosed = wonCount + lostCount;
    const conversionRate = totalClosed > 0 ? Number(((wonCount / totalClosed) * 100).toFixed(1)) : 0;

    return {
      columns,
      summary: {
        totalOpportunities: opportunities.length,
        totalPipelineValue,
        totalWeightedValue,
        wonValue,
        wonCount,
        lostCount,
        conversionRate
      }
    };
  }

  public async createOpportunity(
    data: {
      title: string;
      estimatedValue: number;
      stage?: any;
      probability?: number;
      companyId?: string;
      contactId?: string;
      leadId?: string;
      customerId?: string;
      expectedCloseDate?: Date | string;
      lostReason?: string;
      notes?: string;
      assignedUserId?: string;
    },
    userId?: string
  ) {
    if (data.companyId) {
      await this.assertCompanyOwned(data.companyId);
    }
    if (data.leadId) {
      await this.assertLeadOwned(data.leadId);
    }

    const stage = data.stage || 'QUALIFICATION';
    let probability = data.probability;
    if (probability === undefined || probability === null) {
      const defaults: Record<string, number> = {
        QUALIFICATION: 20,
        PROPOSAL: 50,
        NEGOTIATION: 80,
        WON: 100,
        LOST: 0
      };
      probability = defaults[stage] ?? 20;
    }

    const opportunity = await this.db.opportunity.create({
      data: {
        tenantId: this.tenantId,
        title: data.title,
        estimatedValue: data.estimatedValue,
        stage,
        probability,
        companyId: data.companyId || null,
        contactId: data.contactId || null,
        leadId: data.leadId || null,
        customerId: data.customerId || null,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        lostReason: stage === 'LOST' ? data.lostReason : null,
        notes: data.notes || null,
        assignedUserId: data.assignedUserId || null
      },
      include: {
        company: true,
        contact: true,
        lead: true,
        customer: true
      }
    });

    if (stage === 'WON') {
      await this.handleOpportunityWon(opportunity, userId);
    }

    await AuditService.audit({
      action: 'crm.opportunity.create',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'Opportunity',
      description: `Oportunidade criada: ${opportunity.title} (${opportunity.estimatedValue}€, ${opportunity.stage})`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    return opportunity;
  }

  public async updateOpportunityStage(
    opportunityId: string,
    stage: 'QUALIFICATION' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST',
    metadata?: {
      probability?: number;
      lostReason?: string;
      notes?: string;
    },
    userId?: string
  ) {
    const opp = await this.assertOpportunityOwned(opportunityId);

    const updateData: any = { stage };

    if (stage === 'WON') {
      updateData.probability = 100;
    } else if (stage === 'LOST') {
      updateData.probability = 0;
      updateData.lostReason = metadata?.lostReason || 'Não especificado';
    } else if (metadata?.probability !== undefined) {
      updateData.probability = metadata.probability;
    } else {
      const defaults: Record<string, number> = {
        QUALIFICATION: 20,
        PROPOSAL: 50,
        NEGOTIATION: 80
      };
      updateData.probability = defaults[stage] ?? 20;
    }

    if (metadata?.notes !== undefined) {
      updateData.notes = metadata.notes;
    }

    const updated = await this.db.opportunity.update({
      where: { id: opportunityId },
      data: updateData,
      include: {
        company: true,
        contact: true,
        lead: true,
        customer: true
      }
    });

    if (stage === 'WON') {
      const oppWithRelations = {
        ...updated,
        lead: updated.lead || opp.lead,
        company: updated.company || opp.company
      };
      await this.handleOpportunityWon(oppWithRelations, userId);
      await AuditService.audit({
        action: 'crm.opportunity.won',
        module: 'crm',
        category: 'APPLICATION',
        resource: 'Opportunity',
        description: `Oportunidade ganha: ${updated.title} (${updated.estimatedValue}€, empresa sincronizada)`,
        tenantId: this.tenantId,
        actorType: 'USER'
      }).catch(() => undefined);
    } else if (stage === 'LOST') {
      await AuditService.audit({
        action: 'crm.opportunity.lost',
        module: 'crm',
        category: 'APPLICATION',
        resource: 'Opportunity',
        description: `Oportunidade perdida: ${updated.title} (Motivo: ${updateData.lostReason})`,
        tenantId: this.tenantId,
        actorType: 'USER'
      }).catch(() => undefined);
    } else {
      await AuditService.audit({
        action: 'crm.opportunity.stage_change',
        module: 'crm',
        category: 'APPLICATION',
        resource: 'Opportunity',
        description: `Transição de estágio: ${opp.stage} -> ${stage} (${updated.title})`,
        tenantId: this.tenantId,
        actorType: 'USER'
      }).catch(() => undefined);
    }

    return updated;
  }

  public async updateOpportunity(
    opportunityId: string,
    data: {
      title?: string;
      estimatedValue?: number;
      stage?: any;
      probability?: number;
      expectedCloseDate?: Date | string | null;
      companyId?: string | null;
      contactId?: string | null;
      lostReason?: string | null;
      notes?: string | null;
      assignedUserId?: string | null;
    },
    userId?: string
  ) {
    await this.assertOpportunityOwned(opportunityId);
    if (data.companyId) {
      await this.assertCompanyOwned(data.companyId);
    }

    const payload: any = { ...data };
    if (data.expectedCloseDate) {
      payload.expectedCloseDate = new Date(data.expectedCloseDate);
    }

    const updated = await this.db.opportunity.update({
      where: { id: opportunityId },
      data: payload,
      include: { company: true, contact: true, lead: true, customer: true }
    });

    await AuditService.audit({
      action: 'crm.opportunity.update',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'Opportunity',
      description: `Oportunidade atualizada: ${updated.title} (campos: ${Object.keys(data).join(', ')})`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    return updated;
  }

  public async deleteOpportunity(opportunityId: string, userId?: string) {
    await this.assertOpportunityOwned(opportunityId);

    const deleted = await this.db.opportunity.update({
      where: { id: opportunityId },
      data: { deletedAt: new Date() }
    });

    await AuditService.audit({
      action: 'crm.opportunity.delete',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'Opportunity',
      description: `Oportunidade arquivada via soft delete (ID: ${opportunityId})`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    return deleted;
  }

  private async handleOpportunityWon(opportunity: any, userId?: string) {
    // 1. Se tem empresa associada, atualiza status para CUSTOMER
    if (opportunity.companyId && this.db.company) {
      await this.db.company.update({
        where: { id: opportunity.companyId },
        data: { status: 'CUSTOMER' }
      });
    }

    // 2. Se tem lead associada, atualiza status para CONVERTED
    if (opportunity.leadId && this.db.lead) {
      await this.db.lead.update({
        where: { id: opportunity.leadId },
        data: { status: 'CONVERTED' }
      });
    }

    // 3. Se não tem customerId, cria Customer correspondente
    if (!opportunity.customerId && this.db.customer) {
      const customer = await this.db.customer.create({
        data: {
          tenantId: this.tenantId,
          companyName: opportunity.company?.tradeName || opportunity.lead?.company || opportunity.title,
          website: opportunity.company?.website || opportunity.lead?.website || null,
          assignedUserId: opportunity.assignedUserId || userId || null,
          contacts: opportunity.lead
            ? {
                create: {
                  name: opportunity.lead.name,
                  email: opportunity.lead.email,
                  phone: opportunity.lead.phone || opportunity.lead.mobile || null,
                  role: opportunity.lead.role || 'Contacto Principal',
                  isPrimary: true
                }
              }
            : undefined
        }
      });

      await this.db.opportunity.update({
        where: { id: opportunity.id },
        data: { customerId: customer.id }
      });

      if (opportunity.leadId && this.db.communication) {
        await this.db.communication.updateMany({
          where: { leadId: opportunity.leadId },
          data: { customerId: customer.id }
        });
      }
    }
  }

  public async convertLeadToOpportunity(
    leadId: string,
    estimatedValue: number,
    options?: { createCompany?: boolean; title?: string },
    userId?: string
  ) {
    const lead = await this.assertLeadOwned(leadId);

    await this.db.lead.update({
      where: { id: leadId },
      data: { status: 'QUALIFICATION' }
    });

    let companyId = lead.companyId || null;

    if (!companyId && options?.createCompany !== false && this.db.company && typeof this.db.company.findFirst === 'function') {
      const existing = await this.db.company.findFirst({
        where: {
          tenantId: this.tenantId,
          deletedAt: null,
          tradeName: lead.company
        }
      });

      if (existing) {
        companyId = existing.id;
      } else {
        const newCompany = await this.db.company.create({
          data: {
            tenantId: this.tenantId,
            tradeName: lead.company,
            email: lead.email,
            phone: lead.phone || lead.mobile,
            website: lead.website,
            status: 'LEAD',
            completenessPercent: 20
          }
        });
        companyId = newCompany.id;

        if (lead.name && this.db.companyContact) {
          await this.db.companyContact.create({
            data: {
              companyId: newCompany.id,
              name: lead.name,
              email: lead.email,
              phone: lead.phone || lead.mobile,
              role: lead.role || 'Contacto Principal',
              isPrimary: true
            }
          });
        }
      }

      await this.db.lead.update({
        where: { id: leadId },
        data: { companyId }
      });
    }

    const opportunity = await this.db.opportunity.create({
      data: {
        title: options?.title || `Oportunidade Comercial - ${lead.company}`,
        leadId: lead.id,
        companyId,
        stage: 'QUALIFICATION',
        estimatedValue,
        probability: 20,
        tenantId: this.tenantId,
        assignedUserId: lead.assignedUserId || userId || null
      },
      include: {
        company: true,
        lead: true
      }
    });

    await AuditService.audit({
      action: 'crm.lead.convert',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'Lead',
      description: `Lead convertida em Oportunidade: ${opportunity.title} (${opportunity.estimatedValue}€)`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    return opportunity;
  }

  public async winOpportunityAndCreateCustomer(opportunityId: string, userId?: string) {
    const opp = await this.updateOpportunityStage(opportunityId, 'WON', {}, userId);
    if (opp.customerId && this.db.customer) {
      const cust = this.db.customer.findUnique
        ? await this.db.customer.findUnique({ where: { id: opp.customerId } })
        : (await this.db.customer.findMany({ where: { id: opp.customerId } }))?.[0];
      if (cust) return cust;
    }
    return opp;
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
        phone: normalizePhoneNumber(data.phone),
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
        phone: normalizePhoneNumber(data.phone),
        source: data.sector ? `landing_diagnostico_${data.sector}` : 'landing_diagnostico',
        status: 'NEW'
      }
    });
  }

  public async listLeads() {
    return this.db.lead.findMany({
      where: { tenantId: this.tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' }
    });
  }

  public async updateLead(id: string, data: Partial<{ company: string; name: string; email: string; phone: string; source: string; status: string }>) {
    await this.assertLeadOwned(id);

    const updateData: any = { ...data };
    if (updateData.phone) updateData.phone = normalizePhoneNumber(updateData.phone);

    return this.db.lead.update({
      where: { id },
      data: updateData
    });
  }

  public async deleteLead(id: string) {
    await this.assertLeadOwned(id);
    return this.db.lead.update({
      where: { id },
      data: { deletedAt: new Date() }
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
      this.db.lead.findMany({ where: { tenantId: this.tenantId, deletedAt: null } }),
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
