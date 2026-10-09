import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { prisma as defaultPrismaClient } from '../../../database/prisma/client';
import { AppError } from '../../../utils/errors';
import { AuditService } from '../../platform/services/AuditService';
import { normalizePhoneNumber } from '../utils/validators';
import { TenantMailService, type MailActor } from '../../mail/services/TenantMailService';

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
    if (!contact || !contact.company || contact.company.tenantId !== this.tenantId || Boolean(contact.company.deletedAt)) {
      throw notFound('Contacto não encontrado.');
    }
    return contact;
  }

  public async getOpportunityById(opportunityId: string) {
    return this.assertOpportunityOwned(opportunityId);
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
      include: { company: true, proposal: true }
    });
    if (!contract || !contract.company || contract.company.tenantId !== this.tenantId || Boolean(contract.company.deletedAt)) {
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

  public async assertAccountEntryOwned(entryId: string) {
    const entry = await this.db.crmAccountEntry.findFirst({
      where: { id: entryId, tenantId: this.tenantId },
      include: {
        company: true,
        paymentAllocations: { where: { isCancelled: false } },
        documentAllocations: { where: { isCancelled: false } },
        reversedEntry: true,
        reversals: true
      }
    });
    if (!entry || !entry.company || entry.company.tenantId !== this.tenantId) {
      throw notFound('Lançamento de conta corrente não encontrado.');
    }
    return entry;
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

  public async assertActivityOwned(activityId: string) {
    const activity = await this.db.communication.findFirst({
      where: { id: activityId, tenantId: this.tenantId, deletedAt: null },
      include: { company: true, contact: true, opportunity: true, lead: true }
    });
    if (!activity) {
      throw notFound('Atividade não encontrada.');
    }
    return activity;
  }

  public async assertProposalOwned(proposalId: string) {
    const proposal = await this.db.proposal.findFirst({
      where: { id: proposalId, tenantId: this.tenantId, deletedAt: null },
      include: {
        company: true,
        contact: true,
        opportunity: true,
        items: { orderBy: { sortOrder: 'asc' } }
      }
    });
    if (!proposal) {
      throw notFound('Proposta não encontrada.');
    }
    return proposal;
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
        opportunities: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 },
        communications: {
          where: { deletedAt: null },
          orderBy: { occurredAt: 'desc' },
          take: 50,
          include: {
            contact: { select: { id: true, name: true, email: true, phone: true } },
            opportunity: { select: { id: true, title: true, stage: true } }
          }
        },
        proposals: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { items: true }
        },
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

  // =========================================================================
  // DOCUMENTOS DO CLIENTE & VALIDADES (FASE B6)
  // =========================================================================

  public static computeDocumentStatus(expiryDate: Date | string | null | undefined): {
    status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'PERMANENT';
    daysUntilExpiry: number | null;
    isExpiringSoon: boolean;
    isExpired: boolean;
  } {
    if (!expiryDate) {
      return { status: 'VALID', daysUntilExpiry: null, isExpiringSoon: false, isExpired: false };
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDate);
    exp.setHours(0, 0, 0, 0);
    const diffMs = exp.getTime() - now.getTime();
    const daysUntilExpiry = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
      return { status: 'EXPIRED', daysUntilExpiry, isExpiringSoon: false, isExpired: true };
    }
    if (daysUntilExpiry <= 30) {
      return { status: 'EXPIRING_SOON', daysUntilExpiry, isExpiringSoon: true, isExpired: false };
    }
    return { status: 'VALID', daysUntilExpiry, isExpiringSoon: false, isExpired: false };
  }

  public static getDocTypeLabel(docType?: string | null): string {
    const labels: Record<string, string> = {
      CERTIDAO_PERMANENTE: 'Certidão Permanente',
      RCBE: 'Registo Beneficiário Efetivo (RCBE)',
      DECLARACAO_NIF: 'Cartão de Pessoa Coletiva / NIF',
      PROCURACAO: 'Procuração / Delegação de Poderes',
      ALVARA_LICENCA: 'Alvará / Licença Profissional',
      SEGURO_RC: 'Seguro de Responsabilidade Civil',
      NON_DEBT_AT: 'Certidão Não Dívida (Finanças/AT)',
      NON_DEBT_SS: 'Certidão Não Dívida (Segurança Social)',
      CONTRATO_ASSINADO: 'Contrato Assinado',
      NDA_CONFIDENCIALIDADE: 'Acordo de Confidencialidade (NDA)',
      COMPROVATIVO_IBAN: 'Comprovativo de IBAN',
      RGPD_CONSENTIMENTO: 'Consentimento RGPD',
      OTHER: 'Outro Documento'
    };
    return labels[docType || ''] || docType || 'Outro Documento';
  }

  public async getCompanyDocumentById(docId: string) {
    const doc = await this.assertDocumentOwned(docId);
    const metrics = EnterpriseCRMService.computeDocumentStatus(doc.expiryDate);
    return {
      ...doc,
      daysUntilExpiry: metrics.daysUntilExpiry,
      isExpiringSoon: metrics.isExpiringSoon,
      isExpired: metrics.isExpired,
      statusLabel: metrics.status === 'EXPIRED' ? 'Caducado' : metrics.status === 'EXPIRING_SOON' ? 'A Caducar (<30d)' : 'Válido',
      docTypeLabel: EnterpriseCRMService.getDocTypeLabel(doc.docType)
    };
  }

  public async listCompanyDocuments(companyId: string, options?: {
    status?: string;
    docType?: string;
    verificationStatus?: string;
    includeDeleted?: boolean;
  }) {
    await this.assertCompanyOwned(companyId);

    const rawDocs = await this.db.companyDocument.findMany({
      where: {
        companyId,
        deletedAt: options?.includeDeleted ? undefined : null
      },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = rawDocs.map((doc: any) => {
      const metrics = EnterpriseCRMService.computeDocumentStatus(doc.expiryDate);
      return {
        ...doc,
        computedStatus: metrics.status,
        daysUntilExpiry: metrics.daysUntilExpiry,
        isExpiringSoon: metrics.isExpiringSoon,
        isExpired: metrics.isExpired,
        docTypeLabel: EnterpriseCRMService.getDocTypeLabel(doc.docType)
      };
    });

    let filtered = enriched;
    if (options?.docType) {
      filtered = filtered.filter((d: any) => d.docType === options.docType);
    }
    if (options?.status) {
      filtered = filtered.filter((d: any) => d.computedStatus === options.status || d.status === options.status);
    }
    if (options?.verificationStatus) {
      filtered = filtered.filter((d: any) => d.verificationStatus === options.verificationStatus);
    }

    const kpis = {
      totalCount: enriched.length,
      validCount: enriched.filter((d: any) => d.computedStatus === 'VALID').length,
      expiringSoonCount: enriched.filter((d: any) => d.computedStatus === 'EXPIRING_SOON').length,
      expiredCount: enriched.filter((d: any) => d.computedStatus === 'EXPIRED').length,
      pendingVerificationCount: enriched.filter((d: any) => d.verificationStatus === 'PENDING').length,
      verifiedCount: enriched.filter((d: any) => d.verificationStatus === 'VERIFIED').length
    };

    return { documents: filtered, kpis };
  }

  public async listTenantDocuments(options?: {
    daysAhead?: number;
    expiringOnly?: boolean;
    status?: string;
    docType?: string;
    verificationStatus?: string;
    companyId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const rawDocs = await this.db.companyDocument.findMany({
      where: {
        deletedAt: null,
        company: {
          tenantId: this.tenantId,
          deletedAt: null
        }
      },
      include: {
        company: {
          select: { id: true, tradeName: true, taxNumber: true, status: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = rawDocs.map((doc: any) => {
      const metrics = EnterpriseCRMService.computeDocumentStatus(doc.expiryDate);
      return {
        ...doc,
        computedStatus: metrics.status,
        daysUntilExpiry: metrics.daysUntilExpiry,
        isExpiringSoon: metrics.isExpiringSoon,
        isExpired: metrics.isExpired,
        docTypeLabel: EnterpriseCRMService.getDocTypeLabel(doc.docType)
      };
    });

    const kpis = {
      totalDocuments: enriched.length,
      validCount: enriched.filter((d: any) => d.computedStatus === 'VALID').length,
      expiringSoonCount: enriched.filter((d: any) => d.computedStatus === 'EXPIRING_SOON').length,
      expiredCount: enriched.filter((d: any) => d.computedStatus === 'EXPIRED').length,
      pendingVerificationCount: enriched.filter((d: any) => d.verificationStatus === 'PENDING').length,
      verifiedCount: enriched.filter((d: any) => d.verificationStatus === 'VERIFIED').length
    };

    let filtered = enriched;

    if (options?.companyId) {
      filtered = filtered.filter((d: any) => d.companyId === options.companyId);
    }
    if (options?.docType) {
      filtered = filtered.filter((d: any) => d.docType === options.docType);
    }
    if (options?.verificationStatus) {
      filtered = filtered.filter((d: any) => d.verificationStatus === options.verificationStatus);
    }
    if (options?.expiringOnly) {
      filtered = filtered.filter((d: any) => d.isExpiringSoon || d.isExpired);
    }
    if (options?.status) {
      filtered = filtered.filter((d: any) => d.computedStatus === options.status || d.status === options.status);
    }
    if (options?.daysAhead !== undefined) {
      filtered = filtered.filter((d: any) => d.daysUntilExpiry !== null && d.daysUntilExpiry <= options.daysAhead! && d.daysUntilExpiry >= 0);
    }
    if (options?.search) {
      const q = options.search.toLowerCase();
      filtered = filtered.filter((d: any) =>
        d.name?.toLowerCase().includes(q) ||
        d.docType?.toLowerCase().includes(q) ||
        d.accessCode?.toLowerCase().includes(q) ||
        d.company?.tradeName?.toLowerCase().includes(q) ||
        d.company?.taxNumber?.toLowerCase().includes(q)
      );
    }

    const start = options?.offset || 0;
    const end = options?.limit ? start + options.limit : undefined;
    const paginated = filtered.slice(start, end);

    return {
      documents: paginated,
      totalCount: filtered.length,
      kpis
    };
  }

  public async addCompanyDocument(companyId: string, data: {
    name: string;
    category?: string;
    docType?: string;
    fileUrl?: string | null;
    fileName?: string | null;
    fileSizeBytes?: number | null;
    mimeType?: string | null;
    accessCode?: string | null;
    issueDate?: Date | string | null;
    expiryDate?: Date | string | null;
    expiresAt?: Date | string | null;
    notes?: string | null;
    uploadedBy?: string | null;
  }) {
    await this.assertCompanyOwned(companyId);

    const expDate = data.expiryDate ? new Date(data.expiryDate) : (data.expiresAt ? new Date(data.expiresAt) : null);
    const issDate = data.issueDate ? new Date(data.issueDate) : null;
    const statusMetrics = EnterpriseCRMService.computeDocumentStatus(expDate);

    const docType = data.docType || data.category || 'OTHER';

    const document = await this.db.companyDocument.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        name: data.name.trim(),
        docType,
        fileUrl: data.fileUrl || null,
        fileName: data.fileName || null,
        fileSizeBytes: data.fileSizeBytes || null,
        mimeType: data.mimeType || null,
        accessCode: data.accessCode ? data.accessCode.trim() : null,
        issueDate: issDate,
        expiryDate: expDate,
        status: statusMetrics.status,
        verificationStatus: 'PENDING',
        notes: data.notes || null,
        uploadedBy: data.uploadedBy || null
      }
    });

    const docLabel = EnterpriseCRMService.getDocTypeLabel(docType);
    try {
      await this.createActivity({
        companyId,
        type: 'note',
        subject: `Documento adicionado: ${data.name.trim()} (${docLabel})`,
        content: `Carregado documento empresarial do tipo "${docLabel}".${expDate ? ' Data de Validade: ' + expDate.toISOString().split('T')[0] + '.' : ' Sem data de caducidade pré-definida.'}${data.accessCode ? ' Código de Acesso: ' + data.accessCode + '.' : ''}`,
        createdByUserId: data.uploadedBy || null
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de documento:', e);
    }

    return {
      ...document,
      ...statusMetrics,
      docTypeLabel: docLabel
    };
  }

  public async updateCompanyDocument(docId: string, data: {
    name?: string;
    docType?: string;
    fileUrl?: string | null;
    fileName?: string | null;
    fileSizeBytes?: number | null;
    mimeType?: string | null;
    accessCode?: string | null;
    issueDate?: Date | string | null;
    expiryDate?: Date | string | null;
    notes?: string | null;
    status?: string;
  }, actorUserId?: string) {
    const existing = await this.assertDocumentOwned(docId);

    const updatePayload: any = {};
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (data.docType !== undefined) updatePayload.docType = data.docType;
    if (data.fileUrl !== undefined) updatePayload.fileUrl = data.fileUrl;
    if (data.fileName !== undefined) updatePayload.fileName = data.fileName;
    if (data.fileSizeBytes !== undefined) updatePayload.fileSizeBytes = data.fileSizeBytes;
    if (data.mimeType !== undefined) updatePayload.mimeType = data.mimeType;
    if (data.accessCode !== undefined) updatePayload.accessCode = data.accessCode ? data.accessCode.trim() : null;
    if (data.notes !== undefined) updatePayload.notes = data.notes;

    if (data.issueDate !== undefined) {
      updatePayload.issueDate = data.issueDate ? new Date(data.issueDate) : null;
    }

    if (data.expiryDate !== undefined) {
      const expDate = data.expiryDate ? new Date(data.expiryDate) : null;
      updatePayload.expiryDate = expDate;
      const metrics = EnterpriseCRMService.computeDocumentStatus(expDate);
      updatePayload.status = metrics.status;
    } else if (data.status !== undefined) {
      updatePayload.status = data.status;
    }

    const updated = await this.db.companyDocument.update({
      where: { id: docId },
      data: updatePayload
    });

    const metrics = EnterpriseCRMService.computeDocumentStatus(updated.expiryDate);

    try {
      await this.createActivity({
        companyId: existing.companyId,
        type: 'note',
        subject: `Documento atualizado: ${updated.name}`,
        content: `Dados cadastrais ou validade do documento foram atualizados.`,
        createdByUserId: actorUserId || null
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de atualização de documento:', e);
    }

    return {
      ...updated,
      ...metrics,
      docTypeLabel: EnterpriseCRMService.getDocTypeLabel(updated.docType)
    };
  }

  public async verifyCompanyDocument(docId: string, options: {
    status: 'VERIFIED' | 'REJECTED';
    notes?: string | null;
  }, actorUserId?: string) {
    const doc = await this.assertDocumentOwned(docId);

    const updated = await this.db.companyDocument.update({
      where: { id: docId },
      data: {
        verificationStatus: options.status,
        verifiedBy: actorUserId || null,
        verifiedAt: new Date(),
        notes: options.notes ? (doc.notes ? `${doc.notes}\n[Verificação]: ${options.notes}` : `[Verificação]: ${options.notes}`) : doc.notes
      }
    });

    const actionText = options.status === 'VERIFIED' ? 'aprovado e verificado' : 'rejeitado na verificação';
    try {
      await this.createActivity({
        companyId: doc.companyId,
        type: 'note',
        subject: `Documento ${options.status === 'VERIFIED' ? 'Aprovado' : 'Rejeitado'}: ${doc.name}`,
        content: `O documento ${doc.name} foi ${actionText}.${options.notes ? ' Motivo/Observações: ' + options.notes : ''}`,
        createdByUserId: actorUserId || null
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de verificação de documento:', e);
    }

    const metrics = EnterpriseCRMService.computeDocumentStatus(updated.expiryDate);
    return {
      ...updated,
      ...metrics,
      docTypeLabel: EnterpriseCRMService.getDocTypeLabel(updated.docType)
    };
  }

  public async deleteCompanyDocument(docId: string, actorUserId?: string) {
    const doc = await this.assertDocumentOwned(docId);
    await this.db.companyDocument.update({
      where: { id: docId },
      data: { deletedAt: new Date() }
    });

    try {
      await this.createActivity({
        companyId: doc.companyId,
        type: 'note',
        subject: `Documento arquivado: ${doc.name}`,
        content: `O documento foi removido/arquivado da ficha do cliente.`,
        createdByUserId: actorUserId || null
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de arquivo de documento:', e);
    }

    return { success: true, id: docId };
  }

  public async generateContractNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.db.contract.count({
      where: { tenantId: this.tenantId }
    });
    return `CTR-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  public static calculateMonthlyValue(valueCents: number, billingFrequency: string): number {
    switch (billingFrequency) {
      case 'MONTHLY':
        return valueCents;
      case 'QUARTERLY':
        return Math.round(valueCents / 3);
      case 'SEMIANNUAL':
        return Math.round(valueCents / 6);
      case 'ANNUAL':
        return Math.round(valueCents / 12);
      case 'ONE_OFF':
      default:
        return 0;
    }
  }

  public async getContractById(id: string) {
    const contract = await this.db.contract.findFirst({
      where: { id, tenantId: this.tenantId, deletedAt: null },
      include: {
        company: true,
        proposal: {
          select: { id: true, proposalNumber: true, title: true, totalCents: true }
        }
      }
    });
    if (!contract) {
      throw notFound('Contrato não encontrado.');
    }

    let daysUntilEnd: number | null = null;
    let isExpiringSoon = false;
    if (contract.endDate && !contract.isIndefinite) {
      const now = new Date();
      const diffMs = new Date(contract.endDate).getTime() - now.getTime();
      daysUntilEnd = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (contract.status === 'ACTIVE' && daysUntilEnd <= 30 && daysUntilEnd >= 0) {
        isExpiringSoon = true;
      }
    }

    return {
      ...contract,
      daysUntilEnd,
      isExpiringSoon
    };
  }

  public async listContracts(params?: string | {
    companyId?: string;
    status?: string;
    expiringDays?: number;
    autoRenew?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    // Compatibilidade com chamada simples listContracts(companyId)
    if (typeof params === 'string') {
      const where: any = {
        tenantId: this.tenantId,
        deletedAt: null,
        companyId: params
      };
      await this.assertCompanyOwned(params);
      return this.db.contract.findMany({
        where,
        include: { company: true, proposal: true },
        orderBy: { startDate: 'desc' }
      });
    }

    const filters = params || {};
    const where: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };

    if (filters.companyId) {
      await this.assertCompanyOwned(filters.companyId);
      where.companyId = filters.companyId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.autoRenew !== undefined) {
      where.autoRenew = filters.autoRenew;
    }

    const now = new Date();
    if (filters.expiringDays && filters.expiringDays > 0) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + filters.expiringDays);
      where.endDate = {
        gte: now,
        lte: futureDate
      };
      where.isIndefinite = false;
    }

    const allContracts = await this.db.contract.findMany({
      where: { tenantId: this.tenantId, deletedAt: null },
      include: { company: true, proposal: true },
      orderBy: { startDate: 'desc' }
    });

    let activeCount = 0;
    let mrrCents = 0;
    let expiringIn30Days = 0;
    let pendingSignatureCount = 0;

    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    for (const c of allContracts) {
      if (c.status === 'ACTIVE') {
        activeCount += 1;
        mrrCents += c.monthlyValueCents || 0;
        if (c.endDate && !c.isIndefinite && new Date(c.endDate) >= now && new Date(c.endDate) <= in30Days) {
          expiringIn30Days += 1;
        }
      } else if (c.status === 'PENDING_SIGNATURE') {
        pendingSignatureCount += 1;
      }
    }

    let filtered: any[] = allContracts;
    if (filters.companyId) {
      filtered = filtered.filter((c: any) => c.companyId === filters.companyId);
    }
    if (filters.status) {
      filtered = filtered.filter((c: any) => c.status === filters.status);
    }
    if (filters.autoRenew !== undefined) {
      filtered = filtered.filter((c: any) => c.autoRenew === filters.autoRenew);
    }
    if (filters.expiringDays && filters.expiringDays > 0) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + filters.expiringDays);
      filtered = filtered.filter((c: any) => c.endDate && !c.isIndefinite && new Date(c.endDate) >= now && new Date(c.endDate) <= targetDate);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter((c: any) =>
        (c.contractNumber && c.contractNumber.toLowerCase().includes(q)) ||
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.company?.tradeName && c.company.tradeName.toLowerCase().includes(q))
      );
    }

    const total = filtered.length;
    const offset = filters.offset || 0;
    const limit = filters.limit || 50;
    const paginated = filtered.slice(offset, offset + limit).map((c: any) => {
      let daysUntilEnd: number | null = null;
      let isExpiringSoon = false;
      if (c.endDate && !c.isIndefinite) {
        const diffMs = new Date(c.endDate).getTime() - now.getTime();
        daysUntilEnd = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (c.status === 'ACTIVE' && daysUntilEnd <= 30 && daysUntilEnd >= 0) {
          isExpiringSoon = true;
        }
      }
      return {
        ...c,
        daysUntilEnd,
        isExpiringSoon
      };
    });

    return {
      items: paginated,
      total,
      kpis: {
        totalCount: allContracts.length,
        activeCount,
        mrrCents,
        arrCents: mrrCents * 12,
        expiringIn30Days,
        pendingSignatureCount
      }
    };
  }

  public async createContract(firstArg: string | any, secondArg?: any) {
    let companyId: string;
    let data: any;

    if (typeof firstArg === 'string') {
      companyId = firstArg;
      data = secondArg || {};
    } else {
      data = firstArg || {};
      companyId = data.companyId;
    }

    if (!companyId) {
      throw new AppError('COMPANY_REQUIRED', 'É obrigatório indicar a empresa para o contrato.', 400);
    }

    await this.assertCompanyOwned(companyId);

    if (data.proposalId) {
      await this.assertProposalOwned(data.proposalId);
    }

    const contractNumber = data.contractNumber || (await this.generateContractNumber());
    const billingFrequency = data.billingFrequency || 'MONTHLY';
    const valueCents = Math.round(data.valueCents ?? data.monthlyValueCents ?? data.annualValueCents ?? 0);
    const monthlyValueCents = data.monthlyValueCents !== undefined
      ? Math.round(data.monthlyValueCents)
      : EnterpriseCRMService.calculateMonthlyValue(valueCents, billingFrequency);

    const autoRenew = data.autoRenew !== undefined
      ? data.autoRenew
      : (data.renewalType === 'AUTOMATIC' || data.renewalType === 'AUTO');

    const isIndefinite = Boolean(data.isIndefinite);
    const startDate = data.startDate ? new Date(data.startDate) : new Date();
    const endDate = isIndefinite || !data.endDate ? null : new Date(data.endDate);

    const contract = await this.db.contract.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        proposalId: data.proposalId || null,
        contractNumber,
        title: data.title,
        type: data.type || 'SERVICE',
        status: data.status || 'ACTIVE',
        valueCents,
        monthlyValueCents,
        billingFrequency,
        isIndefinite,
        autoRenew,
        startDate,
        endDate,
        slaLevel: data.slaLevel || 'STANDARD',
        slaResponseHours: data.slaResponseHours ?? null,
        slaResolutionHours: data.slaResolutionHours ?? null,
        renewalNoticeDays: data.renewalNoticeDays ?? data.noticePeriodDays ?? 30,
        termsAndConditions: data.termsAndConditions || data.terms || null,
        notes: data.notes || null,
        documentUrl: data.documentUrl || null
      },
      include: {
        company: true,
        proposal: true
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'CREATE_CONTRACT',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'contract',
      description: `Contrato de avença criado: ${contract.contractNumber} - ${contract.title} (MRR: €${(contract.monthlyValueCents / 100).toFixed(2)})`
    });

    return contract;
  }

  public async updateContract(contractId: string, data: any) {
    const existing = await this.assertContractOwned(contractId);

    if (data.companyId && data.companyId !== existing.companyId) {
      await this.assertCompanyOwned(data.companyId);
    }
    if (data.proposalId && data.proposalId !== existing.proposalId) {
      await this.assertProposalOwned(data.proposalId);
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.billingFrequency !== undefined) updateData.billingFrequency = data.billingFrequency;
    if (data.isIndefinite !== undefined) {
      updateData.isIndefinite = Boolean(data.isIndefinite);
      if (updateData.isIndefinite) updateData.endDate = null;
    }
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined && !updateData.isIndefinite) {
      updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    }
    if (data.autoRenew !== undefined) updateData.autoRenew = Boolean(data.autoRenew);
    if (data.slaLevel !== undefined) updateData.slaLevel = data.slaLevel;
    if (data.slaResponseHours !== undefined) updateData.slaResponseHours = data.slaResponseHours;
    if (data.slaResolutionHours !== undefined) updateData.slaResolutionHours = data.slaResolutionHours;
    if (data.renewalNoticeDays !== undefined) updateData.renewalNoticeDays = data.renewalNoticeDays;
    if (data.documentUrl !== undefined) updateData.documentUrl = data.documentUrl;
    if (data.termsAndConditions !== undefined) updateData.termsAndConditions = data.termsAndConditions;
    if (data.notes !== undefined) updateData.notes = data.notes;

    if (data.valueCents !== undefined) {
      updateData.valueCents = Math.round(data.valueCents);
      const freq = data.billingFrequency || existing.billingFrequency;
      updateData.monthlyValueCents = data.monthlyValueCents !== undefined
        ? Math.round(data.monthlyValueCents)
        : EnterpriseCRMService.calculateMonthlyValue(updateData.valueCents, freq);
    } else if (data.monthlyValueCents !== undefined) {
      updateData.monthlyValueCents = Math.round(data.monthlyValueCents);
    }

    const updated = await this.db.contract.update({
      where: { id: contractId },
      data: updateData,
      include: { company: true, proposal: true }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'UPDATE_CONTRACT',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'contract',
      description: `Contrato atualizado: ${updated.contractNumber}`
    });

    return updated;
  }

  public async renewContract(
    contractId: string,
    options?: {
      extensionMonths?: number;
      newEndDate?: Date | string;
      adjustmentPercent?: number;
      notes?: string;
    },
    actorUserId?: string
  ) {
    const contract = await this.assertContractOwned(contractId);
    const months = options?.extensionMonths || 12;
    let newEndDate: Date;

    if (options?.newEndDate) {
      newEndDate = new Date(options.newEndDate);
    } else if (contract.endDate) {
      newEndDate = new Date(contract.endDate);
      newEndDate.setMonth(newEndDate.getMonth() + months);
    } else {
      newEndDate = new Date();
      newEndDate.setMonth(newEndDate.getMonth() + months);
    }

    const adjustment = options?.adjustmentPercent || 0;
    const multiplier = 1 + (adjustment / 100);
    const newValueCents = adjustment !== 0 ? Math.round(contract.valueCents * multiplier) : contract.valueCents;
    const newMonthlyCents = adjustment !== 0 ? Math.round(contract.monthlyValueCents * multiplier) : contract.monthlyValueCents;

    const renewalDateStr = new Date().toLocaleDateString('pt-PT');
    const renewalNote = `[Renovação de Contrato em ${renewalDateStr}]: Prorrogado até ${newEndDate.toLocaleDateString('pt-PT')} (+${months} meses)${adjustment !== 0 ? ` com atualização de ${adjustment}%` : ''}.${options?.notes ? ` Notas: ${options.notes}` : ''}`;
    const appendedNotes = contract.notes ? `${contract.notes}\n${renewalNote}` : renewalNote;

    const updated = await this.db.contract.update({
      where: { id: contractId },
      data: {
        endDate: newEndDate,
        isIndefinite: false,
        status: 'ACTIVE',
        valueCents: newValueCents,
        monthlyValueCents: newMonthlyCents,
        lastRenewedAt: new Date(),
        notes: appendedNotes
      },
      include: { company: true, proposal: true }
    });

    // Regista atividade comercial de renovação
    try {
      await this.createActivity({
        type: 'task',
        subject: `Renovação Contratual: ${contract.contractNumber}`,
        content: `Contrato de avença "${contract.title}" renovado até ${newEndDate.toLocaleDateString('pt-PT')}. MRR Atualizado: €${(newMonthlyCents / 100).toFixed(2)}.`,
        companyId: contract.companyId,
        status: 'COMPLETED',
        occurredAt: new Date(),
        createdByUserId: actorUserId
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de renovação:', e);
    }

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'RENEW_CONTRACT',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'contract',
      description: `Contrato ${contract.contractNumber} renovado até ${newEndDate.toLocaleDateString('pt-PT')} (Ajuste: ${adjustment}%)`
    });

    return updated;
  }

  public async terminateContract(
    contractId: string,
    options: {
      reason: string;
      cancelledAt?: Date | string;
    },
    actorUserId?: string
  ) {
    const contract = await this.assertContractOwned(contractId);
    const cancelDate = options.cancelledAt ? new Date(options.cancelledAt) : new Date();

    const cancellationNote = `[Contrato Cancelado/Rescindido em ${cancelDate.toLocaleDateString('pt-PT')}]: Motivo: ${options.reason.trim()}`;
    const appendedNotes = contract.notes ? `${contract.notes}\n${cancellationNote}` : cancellationNote;

    const updated = await this.db.contract.update({
      where: { id: contractId },
      data: {
        status: 'CANCELLED',
        cancelledAt: cancelDate,
        cancellationReason: options.reason.trim(),
        notes: appendedNotes
      },
      include: { company: true, proposal: true }
    });

    try {
      await this.createActivity({
        type: 'note',
        subject: `Rescisão de Contrato: ${contract.contractNumber}`,
        content: `Contrato "${contract.title}" cancelado em ${cancelDate.toLocaleDateString('pt-PT')}.\nMotivo: ${options.reason.trim()}`,
        companyId: contract.companyId,
        status: 'COMPLETED',
        occurredAt: cancelDate,
        createdByUserId: actorUserId
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de rescisão:', e);
    }

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'CANCEL_CONTRACT',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'contract',
      description: `Contrato ${contract.contractNumber} cancelado. Motivo: ${options.reason.trim()}`
    });

    return updated;
  }

  public async deleteContract(contractId: string) {
    const contract = await this.assertContractOwned(contractId);

    await this.db.contract.update({
      where: { id: contractId },
      data: { deletedAt: new Date() }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'DELETE_CONTRACT',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'contract',
      description: `Contrato ${contract.contractNumber} arquivado via soft-delete`
    });

    return { success: true };
  }

  public async renderContractSummaryHtml(contractId: string): Promise<string> {
    const contract = await this.getContractById(contractId);
    const fmtEur = (cents: number) => `€${(cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}`;

    return `
      <!DOCTYPE html>
      <html lang="pt">
      <head>
        <meta charset="utf-8">
        <title>Resumo de Contrato — ${contract.contractNumber}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5; font-size: 14px; margin: 0; padding: 24px; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
          .contract-title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          .badge-active { background: #dcfce7; color: #15803d; }
          .badge-cancelled { background: #fee2e2; color: #b91c1c; }
          .badge-pending { background: #fef3c7; color: #b45309; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
          .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px; }
          .value { font-size: 14px; font-weight: 600; color: #0f172a; }
          .legal-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 12px; font-size: 12px; color: #92400e; margin: 24px 0; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; page-break-inside: avoid; }
          .sig-line { border-top: 1px solid #94a3b8; margin-top: 48px; text-align: center; font-size: 12px; color: #64748b; padding-top: 6px; }
          @media print { .no-print { display: none; } body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #fff; padding: 12px 20px; border-radius: 6px;">
          <span>Contrato de Avença Comercial: ${contract.contractNumber}</span>
          <button onclick="window.print()" style="background: #3b82f6; color: #fff; border: 0; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 600;">
            Imprimir ou Guardar em PDF
          </button>
        </div>

        <div class="header">
          <div>
            <div style="font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 700;">Contrato Comercial & SLA</div>
            <h1 class="contract-title">${contract.title}</h1>
            <div style="color: #64748b; font-size: 13px;">Número: <strong>${contract.contractNumber}</strong></div>
          </div>
          <div style="text-align: right;">
            <span class="badge ${contract.status === 'ACTIVE' ? 'badge-active' : (contract.status === 'CANCELLED' ? 'badge-cancelled' : 'badge-pending')}">
              ${contract.status}
            </span>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="label">Entidade Adjudicatária / Cliente</div>
            <div class="value">${contract.company?.tradeName || '—'}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">NIF: ${contract.company?.taxNumber || '—'}</div>
            <div style="font-size: 12px; color: #64748b;">${contract.company?.email || ''} ${contract.company?.phone ? `• ${contract.company.phone}` : ''}</div>
          </div>
          <div class="card">
            <div class="label">Vigência & Período</div>
            <div class="value">
              ${new Date(contract.startDate).toLocaleDateString('pt-PT')} até ${contract.isIndefinite ? 'Tempo Indeterminado' : (contract.endDate ? new Date(contract.endDate).toLocaleDateString('pt-PT') : 'Não definido')}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Renovação Automática: ${contract.autoRenew ? `Sim (${contract.renewalNoticeDays} dias pré-aviso)` : 'Não'}
            </div>
            ${contract.lastRenewedAt ? `<div style="font-size: 11px; color: #059669;">Última renovação: ${new Date(contract.lastRenewedAt).toLocaleDateString('pt-PT')}</div>` : ''}
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="label">Condições Financeiras & Faturação</div>
            <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin: 4px 0;">
              ${fmtEur(contract.monthlyValueCents)} <span style="font-size: 13px; font-weight: 500; color: #64748b;">/ mês (MRR)</span>
            </div>
            <div style="font-size: 13px; color: #64748b;">
              Valor do Período (${contract.billingFrequency}): ${fmtEur(contract.valueCents)}
            </div>
          </div>
          <div class="card">
            <div class="label">Nível de Serviço (SLA)</div>
            <div class="value" style="color: #2563eb;">Nível ${contract.slaLevel || 'STANDARD'}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
              Tempo de Resposta: ${contract.slaResponseHours ? `${contract.slaResponseHours} horas` : 'Padrão'}
            </div>
            <div style="font-size: 12px; color: #64748b;">
              Tempo de Resolução: ${contract.slaResolutionHours ? `${contract.slaResolutionHours} horas` : 'Padrão'}
            </div>
          </div>
        </div>

        ${contract.termsAndConditions ? `
          <div style="margin-bottom: 20px;">
            <div class="label">Termos e Condições Específicos</div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; white-space: pre-wrap;">${contract.termsAndConditions}</div>
          </div>
        ` : ''}

        ${contract.notes ? `
          <div style="margin-bottom: 20px;">
            <div class="label">Notas & Histórico</div>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; white-space: pre-wrap;">${contract.notes}</div>
          </div>
        ` : ''}

        <div class="legal-box">
          ⚠️ <strong>Salvaguarda Legal Inviolável:</strong> Resumo de Contrato Comercial de Prestação de Serviços / Avença. Não serve de fatura nem de documento de quitação fiscal.
        </div>

        <div class="signatures">
          <div>
            <div class="sig-line">Pelo Prestador de Serviços</div>
          </div>
          <div>
            <div class="sig-line">Pelo Cliente / Segundo Outorgante</div>
          </div>
        </div>
      </body>
      </html>
    `;
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

  // =========================================================================
  // ATIVIDADES, TAREFAS & TIMELINE CRONOLÓGICA 360º (FASE B3)
  // =========================================================================

  public async listActivities(filters?: {
    companyId?: string;
    opportunityId?: string;
    contactId?: string;
    leadId?: string;
    status?: string;
    type?: string;
    overdueOnly?: boolean;
    limit?: number;
  }) {
    const now = new Date();
    const where: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };

    if (filters?.companyId) where.companyId = filters.companyId;
    if (filters?.opportunityId) where.opportunityId = filters.opportunityId;
    if (filters?.contactId) where.contactId = filters.contactId;
    if (filters?.leadId) where.leadId = filters.leadId;
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;

    if (filters?.overdueOnly) {
      where.status = 'PENDING';
      where.dueDate = { lt: now };
    }

    const limit = Math.min(filters?.limit ?? 100, 200);

    const items = await this.db.communication.findMany({
      where,
      include: {
        company: { select: { id: true, tradeName: true } },
        contact: { select: { id: true, name: true, email: true, phone: true } },
        opportunity: { select: { id: true, title: true, stage: true, estimatedValue: true } },
        lead: { select: { id: true, name: true, company: true } }
      },
      orderBy: filters?.status === 'PENDING' || filters?.overdueOnly
        ? [{ dueDate: 'asc' }, { createdAt: 'desc' }]
        : [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: limit
    });

    return items.map((item: any) => {
      const isOverdue = item.status === 'PENDING' && item.dueDate && new Date(item.dueDate) < now;
      return {
        ...item,
        isOverdue: !!isOverdue
      };
    });
  }

  public async getPendingActivitiesSummary() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const activities = await this.db.communication.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'PENDING',
        deletedAt: null
      },
      include: {
        company: { select: { id: true, tradeName: true } },
        contact: { select: { id: true, name: true, email: true } },
        opportunity: { select: { id: true, title: true, stage: true } }
      },
      orderBy: { dueDate: 'asc' },
      take: 50
    });

    let overdueCount = 0;
    let dueTodayCount = 0;
    let upcomingCount = 0;

    const mapped = activities.map((item: any) => {
      const isOverdue = item.dueDate && new Date(item.dueDate) < now;
      const isToday = item.dueDate && new Date(item.dueDate) >= todayStart && new Date(item.dueDate) <= todayEnd;

      if (isOverdue) overdueCount += 1;
      if (isToday) dueTodayCount += 1;
      if (item.dueDate && new Date(item.dueDate) > todayEnd) upcomingCount += 1;

      return {
        ...item,
        isOverdue: !!isOverdue,
        isToday: !!isToday
      };
    });

    return {
      totalPending: activities.length,
      overdueCount,
      dueTodayCount,
      upcomingCount,
      activities: mapped
    };
  }

  public async createActivity(data: {
    type: string;
    subject: string;
    content?: string | null;
    status?: string;
    dueDate?: string | Date | null;
    priority?: string | null;
    occurredAt?: string | Date | null;
    companyId?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
    leadId?: string | null;
    createdByUserId?: string | null;
  }) {
    if (data.companyId) {
      await this.assertCompanyOwned(data.companyId);
    }
    if (data.contactId) {
      await this.assertContactOwned(data.contactId);
    }
    if (data.opportunityId) {
      const opp = await this.assertOpportunityOwned(data.opportunityId);
      if (!data.companyId && opp.companyId) {
        data.companyId = opp.companyId;
      }
    }
    if (data.leadId) {
      await this.assertLeadOwned(data.leadId);
    }

    const defaultStatus = data.status || (data.dueDate && new Date(data.dueDate) > new Date() ? 'PENDING' : 'COMPLETED');

    const activity = await this.db.communication.create({
      data: {
        tenantId: this.tenantId,
        type: data.type || 'task',
        subject: data.subject,
        content: data.content || null,
        status: defaultStatus,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        priority: data.priority || 'NORMAL',
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
        companyId: data.companyId || null,
        contactId: data.contactId || null,
        opportunityId: data.opportunityId || null,
        leadId: data.leadId || null,
        createdByUserId: data.createdByUserId || null
      },
      include: {
        company: { select: { id: true, tradeName: true } },
        contact: { select: { id: true, name: true } },
        opportunity: { select: { id: true, title: true } }
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'CREATE_ACTIVITY',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'communication',
      description: `Atividade registada: ${data.subject} (${data.type})`
    });

    return activity;
  }

  public async completeActivity(id: string, notes?: string) {
    const activity = await this.assertActivityOwned(id);

    let updatedContent = activity.content;
    if (notes && notes.trim()) {
      const nowStr = new Date().toLocaleString('pt-PT');
      updatedContent = activity.content
        ? `${activity.content}\n\n[Conclusão em ${nowStr}]: ${notes.trim()}`
        : `[Conclusão em ${nowStr}]: ${notes.trim()}`;
    }

    const updated = await this.db.communication.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        content: updatedContent
      },
      include: {
        company: { select: { id: true, tradeName: true } },
        contact: { select: { id: true, name: true } },
        opportunity: { select: { id: true, title: true } }
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'COMPLETE_ACTIVITY',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'communication',
      description: `Atividade concluída: ${activity.subject}`
    });

    return updated;
  }

  public async updateActivity(id: string, data: any) {
    const activity = await this.assertActivityOwned(id);

    const updateData: any = {};
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.status !== undefined) {
      updateData.status = data.status;
      if (data.status === 'COMPLETED' && activity.status !== 'COMPLETED') {
        updateData.completedAt = new Date();
      }
    }
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    if (data.priority !== undefined) updateData.priority = data.priority;

    const updated = await this.db.communication.update({
      where: { id },
      data: updateData,
      include: {
        company: { select: { id: true, tradeName: true } },
        contact: { select: { id: true, name: true } },
        opportunity: { select: { id: true, title: true } }
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'UPDATE_ACTIVITY',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'communication',
      description: `Atividade atualizada: ${updated.subject}`
    });

    return updated;
  }

  public async deleteActivity(id: string) {
    const activity = await this.assertActivityOwned(id);

    await this.db.communication.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'DELETE_ACTIVITY',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'communication',
      description: `Atividade apagada (soft-delete): ${activity.subject}`
    });

    return { success: true };
  }

  // =========================================================================
  // PROPOSTAS COMERCIAIS & ORÇAMENTOS (FASE B4)
  // =========================================================================

  public async generateProposalNumber(year: number = new Date().getFullYear()): Promise<string> {
    const prefix = `PROP-${year}-`;
    const count = await this.db.proposal.count({
      where: {
        tenantId: this.tenantId,
        proposalNumber: { startsWith: prefix }
      }
    });
    const nextSeq = count + 1;
    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  public static calculateProposalTotals(
    items: Array<{
      description: string;
      quantity?: number;
      unitPriceCents: number;
      discountPercent?: number;
      vatRatePercent?: number;
      sortOrder?: number;
    }>,
    globalVatRate: number = 23.0
  ) {
    let subtotalCents = 0;
    const computedItems = items.map((item, index) => {
      const quantity = item.quantity !== undefined ? item.quantity : 1.0;
      const discount = item.discountPercent || 0.0;
      const vatRate = item.vatRatePercent !== undefined ? item.vatRatePercent : globalVatRate;
      
      const discountedUnit = item.unitPriceCents * (1 - discount / 100);
      const lineTotalCents = Math.round(quantity * discountedUnit);
      subtotalCents += lineTotalCents;

      return {
        description: item.description,
        quantity,
        unitPriceCents: item.unitPriceCents,
        discountPercent: discount,
        vatRatePercent: vatRate,
        totalCents: lineTotalCents,
        sortOrder: item.sortOrder !== undefined ? item.sortOrder : index + 1
      };
    });

    const vatCents = Math.round(subtotalCents * (globalVatRate / 100));
    const totalCents = subtotalCents + vatCents;

    return {
      items: computedItems,
      subtotalCents,
      vatRatePercent: globalVatRate,
      vatCents,
      totalCents
    };
  }

  public async listProposals(filters?: {
    companyId?: string;
    opportunityId?: string;
    status?: string;
    search?: string;
    limit?: number;
  }) {
    const where: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };

    if (filters?.companyId) where.companyId = filters.companyId;
    if (filters?.opportunityId) where.opportunityId = filters.opportunityId;
    if (filters?.status) where.status = filters.status;
    if (filters?.search) {
      where.OR = [
        { proposalNumber: { contains: filters.search, mode: 'insensitive' } },
        { title: { contains: filters.search, mode: 'insensitive' } }
      ];
    }

    const limit = Math.min(filters?.limit ?? 50, 100);

    return this.db.proposal.findMany({
      where,
      include: {
        company: { select: { id: true, tradeName: true, taxNumber: true, email: true } },
        contact: { select: { id: true, name: true, email: true, phone: true } },
        opportunity: { select: { id: true, title: true, stage: true } },
        _count: { select: { items: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  public async getProposalById(id: string) {
    return this.assertProposalOwned(id);
  }

  public async createProposal(data: {
    title: string;
    proposalNumber?: string;
    companyId?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
    issueDate?: string | Date | null;
    validUntil?: string | Date | null;
    vatRatePercent?: number;
    notes?: string | null;
    termsAndConditions?: string | null;
    items: Array<{
      description: string;
      quantity?: number;
      unitPriceCents: number;
      discountPercent?: number;
      vatRatePercent?: number;
      sortOrder?: number;
    }>;
  }) {
    if (data.companyId) {
      await this.assertCompanyOwned(data.companyId);
    }
    if (data.contactId) {
      await this.assertContactOwned(data.contactId);
    }
    if (data.opportunityId) {
      const opp = await this.assertOpportunityOwned(data.opportunityId);
      if (!data.companyId && opp.companyId) {
        data.companyId = opp.companyId;
      }
    }

    const proposalNumber = data.proposalNumber || (await this.generateProposalNumber());
    const calculation = EnterpriseCRMService.calculateProposalTotals(data.items || [], data.vatRatePercent ?? 23.0);

    const proposal = await this.db.proposal.create({
      data: {
        tenantId: this.tenantId,
        proposalNumber,
        title: data.title,
        companyId: data.companyId || null,
        contactId: data.contactId || null,
        opportunityId: data.opportunityId || null,
        status: 'DRAFT',
        issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        subtotalCents: calculation.subtotalCents,
        vatRatePercent: calculation.vatRatePercent,
        vatCents: calculation.vatCents,
        totalCents: calculation.totalCents,
        currency: 'EUR',
        notes: data.notes || null,
        termsAndConditions: data.termsAndConditions || null,
        items: {
          create: calculation.items.map((it) => ({
            description: it.description,
            quantity: it.quantity,
            unitPriceCents: it.unitPriceCents,
            discountPercent: it.discountPercent,
            vatRatePercent: it.vatRatePercent,
            totalCents: it.totalCents,
            sortOrder: it.sortOrder
          }))
        }
      },
      include: {
        company: true,
        contact: true,
        opportunity: true,
        items: { orderBy: { sortOrder: 'asc' } }
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'CREATE_PROPOSAL',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'proposal',
      description: `Proposta criada: ${proposal.proposalNumber} - ${proposal.title} (€${(proposal.totalCents / 100).toFixed(2)})`
    });

    return proposal;
  }

  public async updateProposal(
    id: string,
    data: {
      title?: string;
      companyId?: string | null;
      contactId?: string | null;
      opportunityId?: string | null;
      issueDate?: string | Date | null;
      validUntil?: string | Date | null;
      vatRatePercent?: number;
      notes?: string | null;
      termsAndConditions?: string | null;
      items?: Array<{
        description: string;
        quantity?: number;
        unitPriceCents: number;
        discountPercent?: number;
        vatRatePercent?: number;
        sortOrder?: number;
      }>;
    }
  ) {
    const existing = await this.assertProposalOwned(id);

    if (data.companyId) await this.assertCompanyOwned(data.companyId);
    if (data.contactId) await this.assertContactOwned(data.contactId);
    if (data.opportunityId) await this.assertOpportunityOwned(data.opportunityId);

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.companyId !== undefined) updateData.companyId = data.companyId;
    if (data.contactId !== undefined) updateData.contactId = data.contactId;
    if (data.opportunityId !== undefined) updateData.opportunityId = data.opportunityId;
    if (data.issueDate !== undefined) updateData.issueDate = data.issueDate ? new Date(data.issueDate) : null;
    if (data.validUntil !== undefined) updateData.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.termsAndConditions !== undefined) updateData.termsAndConditions = data.termsAndConditions;

    if (data.items) {
      const calculation = EnterpriseCRMService.calculateProposalTotals(data.items, data.vatRatePercent ?? existing.vatRatePercent);
      updateData.subtotalCents = calculation.subtotalCents;
      updateData.vatRatePercent = calculation.vatRatePercent;
      updateData.vatCents = calculation.vatCents;
      updateData.totalCents = calculation.totalCents;

      // Apagar itens antigos e criar novos
      await this.db.proposalItem.deleteMany({ where: { proposalId: id } });
      updateData.items = {
        create: calculation.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          discountPercent: it.discountPercent,
          vatRatePercent: it.vatRatePercent,
          totalCents: it.totalCents,
          sortOrder: it.sortOrder
        }))
      };
    }

    const updated = await this.db.proposal.update({
      where: { id },
      data: updateData,
      include: {
        company: true,
        contact: true,
        opportunity: true,
        items: { orderBy: { sortOrder: 'asc' } }
      }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'UPDATE_PROPOSAL',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'proposal',
      description: `Proposta atualizada: ${updated.proposalNumber}`
    });

    return updated;
  }

  public async deleteProposal(id: string) {
    const proposal = await this.assertProposalOwned(id);

    await this.db.proposal.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'DELETE_PROPOSAL',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'proposal',
      description: `Proposta eliminada (soft-delete): ${proposal.proposalNumber}`
    });

    return { success: true };
  }

  public async updateProposalStatus(id: string, status: 'ACCEPTED' | 'REJECTED' | 'SENT', reason?: string) {
    const proposal = await this.assertProposalOwned(id);

    const updateData: any = { status };
    const now = new Date();
    if (status === 'ACCEPTED') updateData.acceptedAt = now;
    if (status === 'REJECTED') updateData.rejectedAt = now;
    if (status === 'SENT') updateData.sentAt = now;

    if (reason && reason.trim()) {
      updateData.notes = proposal.notes
        ? `${proposal.notes}\n[Estado ${status} em ${now.toLocaleString('pt-PT')}]: ${reason.trim()}`
        : `[Estado ${status} em ${now.toLocaleString('pt-PT')}]: ${reason.trim()}`;
    }

    const updated = await this.db.proposal.update({
      where: { id },
      data: updateData,
      include: {
        company: true,
        contact: true,
        opportunity: true,
        items: true
      }
    });

    // Se aceite e tiver oportunidade associada, converte a oportunidade em WON!
    if (status === 'ACCEPTED' && proposal.opportunityId) {
      try {
        await this.updateOpportunityStage(proposal.opportunityId, 'WON', {
          notes: `Ganha através da aprovação da proposta ${proposal.proposalNumber}.`
        });
      } catch (e) {
        console.warn('Erro ao sincronizar oportunidade para WON:', e);
      }
    }

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'UPDATE_PROPOSAL_STATUS',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'proposal',
      description: `Estado da proposta ${proposal.proposalNumber} alterado para ${status}`
    });

    return updated;
  }

  public async sendProposalEmail(
    id: string,
    options: { recipientEmail?: string; message?: string },
    actor: MailActor
  ) {
    const proposal = await this.assertProposalOwned(id);

    const recipient = options.recipientEmail || proposal.contact?.email || proposal.company?.email;
    if (!recipient) {
      throw new AppError('RECIPIENT_EMAIL_REQUIRED', 'Não foi indicado nem encontrado nenhum email de destinatário para esta proposta.', 400);
    }

    const htmlBody = await this.generateProposalEmailHtml(proposal, options.message);

    const mailService = new TenantMailService(this.tenantId, this.db);
    const result = await mailService.send(
      {
        to: recipient,
        subject: `Proposta Comercial ${proposal.proposalNumber}: ${proposal.title}`,
        html: htmlBody,
        context: 'crm.proposal',
        relatedType: 'proposal',
        relatedId: proposal.id
      },
      actor
    );

    // Atualiza estado para SENT
    await this.db.proposal.update({
      where: { id: proposal.id },
      data: {
        status: proposal.status === 'DRAFT' ? 'SENT' : proposal.status,
        sentAt: new Date()
      }
    });

    // Regista comunicação / atividade comercial
    try {
      await this.createActivity({
        type: 'email',
        subject: `Proposta ${proposal.proposalNumber} enviada por email`,
        content: `Proposta "${proposal.title}" enviada para ${recipient}.\nValor Total: €${(proposal.totalCents / 100).toFixed(2)}${options.message ? `\n\nMensagem personalizada:\n${options.message}` : ''}`,
        companyId: proposal.companyId,
        contactId: proposal.contactId,
        opportunityId: proposal.opportunityId,
        status: 'COMPLETED',
        occurredAt: new Date(),
        createdByUserId: actor.userId
      });
    } catch (e) {
      console.warn('Aviso ao registar atividade de envio:', e);
    }

    await AuditService.audit({
      tenantId: this.tenantId,
      action: 'SEND_PROPOSAL',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'proposal',
      description: `Proposta ${proposal.proposalNumber} enviada por email para ${recipient}`
    });

    return { success: true, recipient, result };
  }

  public async generateProposalEmailHtml(proposal: any, customMessage?: string): Promise<string> {
    const fmtEur = (cents: number) => `€${(cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}`;
    const rows = proposal.items.map((it: any) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${it.description}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center; font-size: 13px;">${it.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 13px;">${fmtEur(it.unitPriceCents)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700; font-size: 13px;">${fmtEur(it.totalCents)}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px;">
        <div style="max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          
          <div style="background: #0f172a; padding: 24px; color: #ffffff;">
            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 4px;">Orçamento Comercial</div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 700;">${proposal.proposalNumber} — ${proposal.title}</h1>
          </div>

          <div style="padding: 24px;">
            ${customMessage ? `
              <div style="background: #f1f5f9; padding: 14px 16px; border-radius: 6px; margin-bottom: 20px; font-size: 14px; color: #334155; white-space: pre-wrap;">
                ${customMessage}
              </div>
            ` : '<p style="margin-top: 0; font-size: 14px;">Apresentamos a seguinte proposta comercial para a sua apreciação:</p>'}

            <div style="margin-bottom: 20px; font-size: 13px; color: #64748b;">
              <div><strong>Destinatário:</strong> ${proposal.company?.tradeName || 'Exmo.(s) Senhor(es)'}</div>
              ${proposal.contact?.name ? `<div><strong>À atenção de:</strong> ${proposal.contact.name}</div>` : ''}
              <div><strong>Data de Emissão:</strong> ${new Date(proposal.issueDate).toLocaleDateString('pt-PT')}</div>
              ${proposal.validUntil ? `<div><strong>Validade da Proposta:</strong> ${new Date(proposal.validUntil).toLocaleDateString('pt-PT')}</div>` : ''}
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <thead>
                <tr style="background: #f8fafc;">
                  <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: left; font-size: 12px; text-transform: uppercase;">Descrição</th>
                  <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: center; font-size: 12px; text-transform: uppercase;">Qtd</th>
                  <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: right; font-size: 12px; text-transform: uppercase;">P. Unit.</th>
                  <th style="padding: 10px; border-bottom: 2px solid #cbd5e1; text-align: right; font-size: 12px; text-transform: uppercase;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>

            <div style="margin-left: auto; width: 240px; margin-bottom: 24px;">
              <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0;">
                <span>Subtotal:</span>
                <span>${fmtEur(proposal.subtotalCents)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; color: #64748b;">
                <span>IVA (${proposal.vatRatePercent}%):</span>
                <span>${fmtEur(proposal.vatCents)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; border-top: 2px solid #0f172a; padding: 8px 0; color: #0f172a;">
                <span>Total:</span>
                <span>${fmtEur(proposal.totalCents)}</span>
              </div>
            </div>

            ${proposal.termsAndConditions ? `
              <div style="margin-bottom: 20px; font-size: 12px; color: #64748b; background: #f8fafc; padding: 12px; border-radius: 6px;">
                <strong>Condições Comerciais:</strong><br>
                ${proposal.termsAndConditions}
              </div>
            ` : ''}

            <div style="margin-top: 24px; padding: 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 11px; color: #92400e;">
              <strong>Aviso Legal Importante:</strong> Este documento é um orçamento comercial e proposta de honorários prestada a título informativo. Não serve de fatura nem de documento de quitação fiscal nos termos da legislação aplicável.
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  public async renderProposalHtml(id: string): Promise<string> {
    const proposal = await this.assertProposalOwned(id);
    const fmtEur = (cents: number) => `€${(cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}`;

    const rows = proposal.items.map((it: any, idx: number) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${idx + 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 500;">${it.description}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;">${it.quantity}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${fmtEur(it.unitPriceCents)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${it.discountPercent > 0 ? `${it.discountPercent}%` : '—'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${it.vatRatePercent}%</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">${fmtEur(it.totalCents)}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html lang="pt">
      <head>
        <meta charset="utf-8">
        <title>Proposta Comercial ${proposal.proposalNumber}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 40px;
            background: #fff;
          }
          .header-table { width: 100%; margin-bottom: 30px; }
          .title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; }
          .meta { font-size: 13px; color: #64748b; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; }
          .items-table { width: 100%; border-collapse: collapse; margin-top: 24px; margin-bottom: 24px; }
          .items-table th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #cbd5e1; }
          .totals-wrap { margin-left: auto; width: 280px; margin-bottom: 30px; }
          .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
          .totals-total { border-top: 2px solid #0f172a; padding: 10px 0; font-size: 18px; font-weight: 800; }
          .legal-box { padding: 14px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 11px; color: #92400e; margin-top: 30px; }
          .btn-print {
            padding: 10px 20px;
            background: #2563eb;
            color: #fff;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            margin-bottom: 20px;
          }
          @media print {
            .no-print { display: none !important; }
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom: 20px;">
          <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
        </div>

        <table class="header-table">
          <tr>
            <td style="vertical-align: top;">
              <h1 class="title">${proposal.title}</h1>
              <div class="meta"><strong>N.º Proposta:</strong> ${proposal.proposalNumber}</div>
              <div class="meta"><strong>Data de Emissão:</strong> ${new Date(proposal.issueDate).toLocaleDateString('pt-PT')}</div>
              ${proposal.validUntil ? `<div class="meta"><strong>Válida até:</strong> ${new Date(proposal.validUntil).toLocaleDateString('pt-PT')}</div>` : ''}
              <div class="meta" style="margin-top: 8px;"><strong>Estado:</strong> <span class="badge" style="background:#e2e8f0;">${proposal.status}</span></div>
            </td>
            <td style="vertical-align: top; text-align: right; width: 45%;">
              <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${proposal.company?.tradeName || 'Cliente'}</div>
              ${proposal.contact?.name ? `<div class="meta">À atenção de: ${proposal.contact.name}</div>` : ''}
              ${proposal.company?.taxNumber ? `<div class="meta">NIF: ${proposal.company.taxNumber}</div>` : ''}
              ${proposal.company?.address ? `<div class="meta">${proposal.company.address}</div>` : ''}
              ${proposal.contact?.email ? `<div class="meta">${proposal.contact.email}</div>` : (proposal.company?.email ? `<div class="meta">${proposal.company.email}</div>` : '')}
            </td>
          </tr>
        </table>

        ${proposal.notes ? `<div style="background: #f8fafc; padding: 12px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;">${proposal.notes.replace(/\n/g, '<br>')}</div>` : ''}

        <table class="items-table">
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">#</th>
              <th>Descrição dos Serviços / Produtos</th>
              <th style="text-align: center; width: 60px;">Qtd</th>
              <th style="text-align: right; width: 100px;">P. Unitário</th>
              <th style="text-align: right; width: 70px;">Desc.</th>
              <th style="text-align: right; width: 60px;">IVA</th>
              <th style="text-align: right; width: 110px;">Total (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="totals-wrap">
          <div class="totals-row">
            <span>Subtotal:</span>
            <span>${fmtEur(proposal.subtotalCents)}</span>
          </div>
          <div class="totals-row" style="color: #64748b;">
            <span>IVA (${proposal.vatRatePercent}%):</span>
            <span>${fmtEur(proposal.vatCents)}</span>
          </div>
          <div class="totals-row totals-total">
            <span>Total da Proposta:</span>
            <span>${fmtEur(proposal.totalCents)}</span>
          </div>
        </div>

        ${proposal.termsAndConditions ? `
          <div style="margin-top: 24px; font-size: 12px; color: #475569;">
            <strong>Termos e Condições Comerciais:</strong>
            <p style="margin: 4px 0; white-space: pre-wrap;">${proposal.termsAndConditions}</p>
          </div>
        ` : ''}

        <div class="legal-box">
          <strong>Aviso Legal & Regulamentar:</strong> Este documento consubstancia um orçamento comercial e proposta de prestação de serviços a título indicativo. Não serve de fatura nem de documento de quitação fiscal nos termos do artigo 36.º do Código do IVA.
        </div>
      </body>
      </html>
    `;
  }

  // =========================================================================
  // FASE B7 — CONTA CORRENTE DE CLIENTES (REGISTO SEM FATURAÇÃO FISCAL)
  // =========================================================================

  public async createAccountEntry(
    companyId: string,
    data: {
      type: string;
      amountCents: number;
      entryDate?: string | Date;
      externalDocumentNumber?: string | null;
      dueDate?: string | Date | null;
      method?: string | null;
      reference?: string | null;
      notes?: string | null;
      proposalId?: string | null;
      autoAllocate?: boolean;
    },
    userId?: string
  ) {
    const company = await this.assertCompanyOwned(companyId);

    const amountCents = Math.round(Number(data.amountCents));
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new AppError('INVALID_AMOUNT', 'O montante deve ser um valor inteiro positivo em cêntimos.', 400);
    }

    const type = String(data.type || '').trim().toUpperCase();
    const validTypes = [
      'OPENING_BALANCE',
      'INVOICE',
      'DEBIT_NOTE',
      'CREDIT_NOTE',
      'PAYMENT',
      'REFUND',
      'ADJUSTMENT',
      'REVERSAL'
    ];
    if (!validTypes.includes(type)) {
      throw new AppError('INVALID_TYPE', `Tipo de lançamento inválido: ${type}`, 400);
    }

    // Validação estrita: INVOICE, DEBIT_NOTE e CREDIT_NOTE exigem número de documento externo emitido no software de faturação
    if (['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'].includes(type)) {
      if (!data.externalDocumentNumber || !data.externalDocumentNumber.trim()) {
        throw new AppError(
          'MISSING_EXTERNAL_DOC',
          'O número de documento externo emitido no software de faturação certificado é obrigatório.',
          400
        );
      }
    }

    const entryDate = data.entryDate ? new Date(data.entryDate) : new Date();
    const dueDate = data.dueDate ? new Date(data.dueDate) : null;

    const entry = await this.db.crmAccountEntry.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        entryDate,
        type,
        externalDocumentNumber: data.externalDocumentNumber ? data.externalDocumentNumber.trim() : null,
        dueDate,
        amountCents,
        method: data.method ? data.method.trim().toUpperCase() : null,
        reference: data.reference ? data.reference.trim() : null,
        notes: data.notes ? data.notes.trim() : null,
        proposalId: data.proposalId || null,
        createdBy: userId || null
      }
    });

    // Se for pagamento com alocação automática (FIFO)
    let autoAllocatedCents = 0;
    if (type === 'PAYMENT' && data.autoAllocate) {
      // Buscar documentos a débito em aberto ordenados cronologicamente
      const debitEntries = await this.db.crmAccountEntry.findMany({
        where: {
          tenantId: this.tenantId,
          companyId,
          type: { in: ['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'] },
          isReversed: false
        },
        include: {
          documentAllocations: {
            where: { isCancelled: false }
          }
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }]
      });

      let remainingPayment = amountCents;

      for (const doc of debitEntries) {
        if (remainingPayment <= 0) break;

        const alreadyAllocated = doc.documentAllocations.reduce((sum: number, a: any) => sum + a.amountCents, 0);
        const pendingOnDoc = doc.amountCents - alreadyAllocated;

        if (pendingOnDoc > 0) {
          const allocAmount = Math.min(remainingPayment, pendingOnDoc);
          await this.db.crmAccountAllocation.create({
            data: {
              tenantId: this.tenantId,
              companyId,
              paymentEntryId: entry.id,
              documentEntryId: doc.id,
              amountCents: allocAmount
            }
          });
          remainingPayment -= allocAmount;
          autoAllocatedCents += allocAmount;
        }
      }
    }

    await AuditService.audit({
      action: 'crm.account_entry.create',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'CrmAccountEntry',
      resourceId: entry.id,
      description: `Lançamento de conta corrente ${type} (€${(amountCents / 100).toFixed(2)}) para empresa ${companyId}`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    try {
      await this.createActivity({
        type: 'NOTE',
        subject: `Conta Corrente: Lançamento de ${type} (€${(amountCents / 100).toFixed(2)})`,
        content: `Registo de ${type} no valor de €${(amountCents / 100).toFixed(2)}. ${entry.externalDocumentNumber ? `Doc: ${entry.externalDocumentNumber}.` : ''} ${entry.notes ? `Notas: ${entry.notes}` : ''}`,
        companyId,
        createdByUserId: userId || null
      });
    } catch {
      // Silêncio se o registo de atividade secundária falhar
    }

    return this.assertAccountEntryOwned(entry.id);
  }

  public async createReversal(entryId: string, reason: string, userId?: string) {
    const entry = await this.assertAccountEntryOwned(entryId);

    if (entry.isReversed) {
      throw new AppError('ALREADY_REVERSED', 'Este lançamento já se encontra estornado.', 400);
    }
    if (entry.type === 'REVERSAL') {
      throw new AppError('CANNOT_REVERSE_REVERSAL', 'Não é possível efetuar o estorno de um estorno.', 400);
    }

    // 1. Marcar o lançamento original como estornado
    await this.db.crmAccountEntry.update({
      where: { id: entry.id },
      data: {
        isReversed: true,
        reversedAt: new Date()
      }
    });

    // 2. Cancelar alocações ativas ligadas a este lançamento
    if (entry.paymentAllocations && entry.paymentAllocations.length > 0) {
      for (const alloc of entry.paymentAllocations) {
        await this.db.crmAccountAllocation.update({
          where: { id: alloc.id },
          data: {
            isCancelled: true,
            cancelledAt: new Date()
          }
        });
      }
    }
    if (entry.documentAllocations && entry.documentAllocations.length > 0) {
      for (const alloc of entry.documentAllocations) {
        await this.db.crmAccountAllocation.update({
          where: { id: alloc.id },
          data: {
            isCancelled: true,
            cancelledAt: new Date()
          }
        });
      }
    }

    // 3. Criar contrapartida de tipo REVERSAL
    const reversal = await this.db.crmAccountEntry.create({
      data: {
        tenantId: this.tenantId,
        companyId: entry.companyId,
        entryDate: new Date(),
        type: 'REVERSAL',
        externalDocumentNumber: entry.externalDocumentNumber ? `EST-${entry.externalDocumentNumber}` : null,
        amountCents: entry.amountCents,
        notes: reason ? reason.trim() : `Estorno do lançamento ${entry.id}`,
        reversesEntryId: entry.id,
        createdBy: userId || null
      }
    });

    await AuditService.audit({
      action: 'crm.account_entry.reverse',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'CrmAccountEntry',
      resourceId: entry.id,
      description: `Estorno do lançamento ${entry.id} (${reason || 'Sem motivo'})`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    try {
      await this.createActivity({
        type: 'NOTE',
        subject: `Conta Corrente: Estorno de ${entry.type} (€${(entry.amountCents / 100).toFixed(2)})`,
        content: `Estorno efetuado para o lançamento original ${entry.id} (${entry.externalDocumentNumber || ''}). Motivo: ${reason || 'Não indicado'}.`,
        companyId: entry.companyId,
        createdByUserId: userId || null
      });
    } catch {
      // Ignorar falha de atividade secundária
    }

    return {
      success: true,
      originalEntryId: entry.id,
      reversalEntryId: reversal.id
    };
  }

  public async allocatePayment(
    companyId: string,
    paymentEntryId: string,
    documentEntryId: string,
    amountCents: number,
    userId?: string
  ) {
    await this.assertCompanyOwned(companyId);

    const payment = await this.assertAccountEntryOwned(paymentEntryId);
    const doc = await this.assertAccountEntryOwned(documentEntryId);

    if (payment.companyId !== companyId || doc.companyId !== companyId) {
      throw new AppError('COMPANY_MISMATCH', 'Os lançamentos devem pertencer à mesma empresa.', 400);
    }

    if (payment.isReversed || doc.isReversed) {
      throw new AppError('ENTRY_REVERSED', 'Não é possível alocar lançamentos estornados.', 400);
    }

    const creditTypes = ['PAYMENT', 'CREDIT_NOTE'];
    const debitTypes = ['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'];

    if (!creditTypes.includes(payment.type)) {
      throw new AppError('INVALID_PAYMENT_ENTRY', 'O lançamento de pagamento deve ser de crédito (PAYMENT ou CREDIT_NOTE).', 400);
    }

    if (!debitTypes.includes(doc.type)) {
      throw new AppError('INVALID_DOCUMENT_ENTRY', 'O documento a liquidar deve ser de débito (INVOICE, DEBIT_NOTE ou OPENING_BALANCE).', 400);
    }

    const allocCents = Math.round(Number(amountCents));
    if (!Number.isInteger(allocCents) || allocCents <= 0) {
      throw new AppError('INVALID_AMOUNT', 'O montante a alocar deve ser um inteiro positivo em cêntimos.', 400);
    }

    // Validar saldo disponível do pagamento
    const currentPaymentAllocations = payment.paymentAllocations.reduce((acc: number, a: any) => acc + a.amountCents, 0);
    const unallocatedPayment = payment.amountCents - currentPaymentAllocations;
    if (allocCents > unallocatedPayment) {
      throw new AppError('OVER_ALLOCATION_PAYMENT', `Montante a alocar (€${(allocCents / 100).toFixed(2)}) excede o saldo disponível do pagamento (€${(unallocatedPayment / 100).toFixed(2)}).`, 400);
    }

    // Validar saldo em aberto do documento
    const currentDocAllocations = doc.documentAllocations.reduce((acc: number, a: any) => acc + a.amountCents, 0);
    const pendingOnDoc = doc.amountCents - currentDocAllocations;
    if (allocCents > pendingOnDoc) {
      throw new AppError('OVER_ALLOCATION_DOC', `Montante a alocar (€${(allocCents / 100).toFixed(2)}) excede o valor pendente do documento (€${(pendingOnDoc / 100).toFixed(2)}).`, 400);
    }

    const allocation = await this.db.crmAccountAllocation.create({
      data: {
        tenantId: this.tenantId,
        companyId,
        paymentEntryId,
        documentEntryId,
        amountCents: allocCents
      }
    });

    await AuditService.audit({
      action: 'crm.account_allocation.create',
      module: 'crm',
      category: 'APPLICATION',
      resource: 'CrmAccountAllocation',
      resourceId: allocation.id,
      description: `Alocação de pagamento ${paymentEntryId} ao documento ${documentEntryId} (€${(allocCents / 100).toFixed(2)})`,
      tenantId: this.tenantId,
      actorType: 'USER'
    }).catch(() => undefined);

    return allocation;
  }

  public async getCustomerStatement(
    companyId: string,
    filters?: {
      from?: string | Date;
      to?: string | Date;
      status?: 'ALL' | 'OPEN' | 'SETTLED';
    }
  ) {
    const company = await this.assertCompanyOwned(companyId);

    const entries = await this.db.crmAccountEntry.findMany({
      where: {
        tenantId: this.tenantId,
        companyId
      },
      include: {
        paymentAllocations: {
          where: { isCancelled: false },
          include: {
            documentEntry: {
              select: { id: true, externalDocumentNumber: true, type: true }
            }
          }
        },
        documentAllocations: {
          where: { isCancelled: false },
          include: {
            paymentEntry: {
              select: { id: true, externalDocumentNumber: true, type: true, method: true }
            }
          }
        },
        reversedEntry: {
          select: { id: true, type: true, externalDocumentNumber: true }
        },
        reversals: {
          select: { id: true, type: true, createdAt: true }
        }
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }]
    });

    const isDebit = (type: string, reversesEntryType?: string | null) => {
      if (type === 'REVERSAL') {
        // Estorno de crédito funciona como débito; estorno de débito funciona como crédito
        return ['PAYMENT', 'CREDIT_NOTE'].includes(reversesEntryType || '');
      }
      return ['INVOICE', 'DEBIT_NOTE', 'REFUND', 'OPENING_BALANCE'].includes(type);
    };

    let runningBalanceCents = 0;
    let totalDebitCents = 0;
    let totalCreditCents = 0;
    let overdueBalanceCents = 0;
    const now = new Date();

    const formattedEntries = entries.map((e: any) => {
      const debit = isDebit(e.type, e.reversedEntry?.type);
      let debitCents = 0;
      let creditCents = 0;

      if (debit) {
        debitCents = e.amountCents;
        runningBalanceCents += e.amountCents;
        totalDebitCents += e.amountCents;
      } else {
        creditCents = e.amountCents;
        runningBalanceCents -= e.amountCents;
        totalCreditCents += e.amountCents;
      }

      // Cálculo de montante em aberto
      let allocatedCents = 0;
      let pendingCents = 0;
      let isSettled = false;

      if (['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'].includes(e.type)) {
        allocatedCents = e.documentAllocations.reduce((sum: number, a: any) => sum + a.amountCents, 0);
        pendingCents = e.isReversed ? 0 : Math.max(0, e.amountCents - allocatedCents);
        isSettled = pendingCents === 0;

        if (pendingCents > 0 && e.dueDate && new Date(e.dueDate) < now) {
          overdueBalanceCents += pendingCents;
        }
      } else if (['PAYMENT', 'CREDIT_NOTE'].includes(e.type)) {
        allocatedCents = e.paymentAllocations.reduce((sum: number, a: any) => sum + a.amountCents, 0);
        pendingCents = e.isReversed ? 0 : Math.max(0, e.amountCents - allocatedCents); // Saldo a favor por alocar
        isSettled = pendingCents === 0;
      }

      return {
        id: e.id,
        entryDate: e.entryDate,
        createdAt: e.createdAt,
        type: e.type,
        externalDocumentNumber: e.externalDocumentNumber,
        dueDate: e.dueDate,
        amountCents: e.amountCents,
        debitCents,
        creditCents,
        runningBalanceCents,
        allocatedCents,
        pendingCents,
        isSettled,
        isReversed: e.isReversed,
        reversedAt: e.reversedAt,
        reversesEntryId: e.reversesEntryId,
        reversedEntry: e.reversedEntry,
        method: e.method,
        reference: e.reference,
        notes: e.notes,
        paymentAllocations: e.paymentAllocations,
        documentAllocations: e.documentAllocations
      };
    });

    // Filtros adicionais se fornecidos
    let filteredEntries = formattedEntries;
    if (filters?.from) {
      const fromDate = new Date(filters.from);
      filteredEntries = filteredEntries.filter((e: any) => new Date(e.entryDate) >= fromDate);
    }
    if (filters?.to) {
      const toDate = new Date(filters.to);
      filteredEntries = filteredEntries.filter((e: any) => new Date(e.entryDate) <= toDate);
    }
    if (filters?.status === 'OPEN') {
      filteredEntries = filteredEntries.filter((e: any) => !e.isSettled && !e.isReversed);
    } else if (filters?.status === 'SETTLED') {
      filteredEntries = filteredEntries.filter((e: any) => e.isSettled || e.isReversed);
    }

    return {
      company: {
        id: company.id,
        tradeName: company.tradeName,
        legalName: company.legalName,
        taxNumber: company.taxNumber,
        email: company.email,
        phone: company.phone,
        address: company.address,
        postalCode: company.postalCode,
        city: company.city
      },
      statementDate: now,
      legalDisclaimer: 'Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal.',
      totalDebitCents,
      totalCreditCents,
      balanceCents: totalDebitCents - totalCreditCents,
      overdueBalanceCents,
      entries: filteredEntries
    };
  }

  public async getCustomerBalances(companyId: string) {
    const statement = await this.getCustomerStatement(companyId);
    const now = new Date().getTime();

    let currentCents = 0;
    let overdue1to30Cents = 0;
    let overdue31to60Cents = 0;
    let overdue61to90Cents = 0;
    let overdueOver90Cents = 0;

    const pendingDocuments: any[] = [];

    for (const e of statement.entries) {
      if (['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'].includes(e.type) && e.pendingCents > 0 && !e.isReversed) {
        let daysOverdue = 0;
        if (e.dueDate) {
          const diffMs = now - new Date(e.dueDate).getTime();
          daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }

        if (daysOverdue <= 0) {
          currentCents += e.pendingCents;
        } else if (daysOverdue <= 30) {
          overdue1to30Cents += e.pendingCents;
        } else if (daysOverdue <= 60) {
          overdue31to60Cents += e.pendingCents;
        } else if (daysOverdue <= 90) {
          overdue61to90Cents += e.pendingCents;
        } else {
          overdueOver90Cents += e.pendingCents;
        }

        pendingDocuments.push({
          id: e.id,
          externalDocumentNumber: e.externalDocumentNumber,
          type: e.type,
          entryDate: e.entryDate,
          dueDate: e.dueDate,
          amountCents: e.amountCents,
          allocatedCents: e.allocatedCents,
          pendingCents: e.pendingCents,
          daysOverdue: Math.max(0, daysOverdue)
        });
      }
    }

    return {
      company: statement.company,
      legalDisclaimer: statement.legalDisclaimer,
      totalDebitCents: statement.totalDebitCents,
      totalCreditCents: statement.totalCreditCents,
      currentBalanceCents: statement.balanceCents,
      overdueBalanceCents: statement.overdueBalanceCents,
      aging: {
        currentCents,
        overdue1to30Cents,
        overdue31to60Cents,
        overdue61to90Cents,
        overdueOver90Cents
      },
      pendingDocuments
    };
  }

  public async getGlobalAccountSummary() {
    const companies = await this.db.company.findMany({
      where: {
        tenantId: this.tenantId,
        deletedAt: null
      },
      select: { id: true, tradeName: true, taxNumber: true }
    });

    let totalReceivableCents = 0;
    let totalOverdueCents = 0;
    let companiesWithDebtCount = 0;
    let companiesOverdueCount = 0;

    const debtors: any[] = [];

    for (const c of companies) {
      const balances = await this.getCustomerBalances(c.id);
      if (balances.currentBalanceCents > 0) {
        totalReceivableCents += balances.currentBalanceCents;
        companiesWithDebtCount++;
      }
      if (balances.overdueBalanceCents > 0) {
        totalOverdueCents += balances.overdueBalanceCents;
        companiesOverdueCount++;
      }
      if (balances.currentBalanceCents > 0 || balances.overdueBalanceCents > 0) {
        debtors.push({
          companyId: c.id,
          tradeName: c.tradeName,
          taxNumber: c.taxNumber,
          balanceCents: balances.currentBalanceCents,
          overdueBalanceCents: balances.overdueBalanceCents,
          aging: balances.aging
        });
      }
    }

    return {
      legalDisclaimer: 'Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal.',
      totalReceivableCents,
      totalOverdueCents,
      companiesWithDebtCount,
      companiesOverdueCount,
      debtors
    };
  }

  public async renderStatementHtml(companyId: string, filters?: any): Promise<string> {
    const statement = await this.getCustomerStatement(companyId, filters);
    const fmtEur = (cents: number) => `€${(cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}`;
    const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('pt-PT') : '—';

    const rows = statement.entries.map((e: any, idx: number) => `
      <tr style="${e.isReversed ? 'text-decoration: line-through; opacity: 0.6;' : ''}">
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; text-align: center;">${idx + 1}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">${fmtDate(e.entryDate)}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-weight: 600;">${e.type}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">${e.externalDocumentNumber || e.reference || '—'}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px;">${fmtDate(e.dueDate)}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; text-align: right; color: #dc2626; font-weight: ${e.debitCents > 0 ? '600' : 'normal'};">
          ${e.debitCents > 0 ? fmtEur(e.debitCents) : '—'}
        </td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; text-align: right; color: #16a34a; font-weight: ${e.creditCents > 0 ? '600' : 'normal'};">
          ${e.creditCents > 0 ? fmtEur(e.creditCents) : '—'}
        </td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; text-align: right; font-weight: 700; color: ${e.runningBalanceCents > 0 ? '#b91c1c' : '#15803d'};">
          ${fmtEur(e.runningBalanceCents)}
        </td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html lang="pt">
      <head>
        <meta charset="utf-8">
        <title>Extrato de Conta Corrente — ${statement.company.tradeName}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 30px;
            background: #fff;
          }
          .header-box { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
          .title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; }
          .subtitle { font-size: 12px; color: #64748b; }
          .client-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 20px; }
          .client-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
          .summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
          .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
          .card-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .card-value { font-size: 16px; font-weight: 800; margin-top: 4px; }
          .statement-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          .statement-table th { background: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #cbd5e1; }
          .legal-notice {
            background: #fffbeb;
            border-left: 4px solid #f59e0b;
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 11px;
            color: #78350f;
            margin-top: 30px;
            line-height: 1.5;
          }
          @media print {
            body { padding: 10mm; }
            .btn-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div style="display: flex; justify-content: flex-end; margin-bottom: 12px;" class="btn-print">
          <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 600; cursor: pointer;">Imprimir Extrato A4</button>
        </div>

        <div class="header-box">
          <div>
            <div class="title">EXTRATO DE CONTA CORRENTE</div>
            <div class="subtitle">Extrato informativo — não é um documento fiscal</div>
          </div>
          <div style="text-align: right; font-size: 12px; color: #64748b;">
            <div>Emissão: <strong>${fmtDate(statement.statementDate)}</strong></div>
            <div>Posição Contabilística Integrada</div>
          </div>
        </div>

        <div class="client-box">
          <div class="client-grid">
            <div><strong>Cliente:</strong> ${statement.company.tradeName} ${statement.company.legalName ? `(${statement.company.legalName})` : ''}</div>
            <div><strong>NIF:</strong> ${statement.company.taxNumber || '—'}</div>
            <div><strong>Email:</strong> ${statement.company.email || '—'}</div>
            <div><strong>Morada:</strong> ${statement.company.address || '—'}, ${statement.company.postalCode || ''} ${statement.company.city || ''}</div>
          </div>
        </div>

        <div class="summary-cards">
          <div class="summary-card">
            <div class="card-label">Total Débitos</div>
            <div class="card-value" style="color: #dc2626;">${fmtEur(statement.totalDebitCents)}</div>
          </div>
          <div class="summary-card">
            <div class="card-label">Total Créditos</div>
            <div class="card-value" style="color: #16a34a;">${fmtEur(statement.totalCreditCents)}</div>
          </div>
          <div class="summary-card">
            <div class="card-label">Saldo Atual</div>
            <div class="card-value" style="color: ${statement.balanceCents > 0 ? '#b91c1c' : '#15803d'};">
              ${fmtEur(statement.balanceCents)}
            </div>
          </div>
          <div class="summary-card">
            <div class="card-label">Saldo Vencido</div>
            <div class="card-value" style="color: #ea580c;">${fmtEur(statement.overdueBalanceCents)}</div>
          </div>
        </div>

        <table class="statement-table">
          <thead>
            <tr>
              <th style="width: 30px; text-align: center;">#</th>
              <th style="width: 85px;">Data</th>
              <th style="width: 110px;">Tipo</th>
              <th>Doc. / Referência</th>
              <th style="width: 85px;">Vencimento</th>
              <th style="text-align: right; width: 100px;">Débito</th>
              <th style="text-align: right; width: 100px;">Crédito</th>
              <th style="text-align: right; width: 110px;">Saldo</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="legal-notice">
          <strong>Salvaguarda Legal & Regulamentar:</strong><br>
          ${statement.legalDisclaimer}<br>
          Este extrato reflete os lançamentos informativos geridos na relação comercial com o cliente. Não substitui faturas, notas de crédito ou recibos emitidos nos termos do Artigo 36.º do Código do IVA.
        </div>
      </body>
      </html>
    `;
  }

  public async sendStatementEmail(
    companyId: string,
    targetEmail: string,
    actor: MailActor,
    notes?: string
  ) {
    const company = await this.assertCompanyOwned(companyId);
    const balances = await this.getCustomerBalances(companyId);

    const fmtEur = (c: number) => `€${(c / 100).toFixed(2)}`;

    const subject = `Extrato de Conta Corrente — ${company.tradeName}`;
    const textBody = `
Estimado(a) Cliente,

Enviamos o resumo da conta corrente para ${company.tradeName}:

- Saldo em Débito: ${fmtEur(balances.currentBalanceCents)}
- Saldo Vencido: ${fmtEur(balances.overdueBalanceCents)}

${notes ? `Observações:\n${notes}\n\n` : ''}

Salvaguarda Legal:
Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal.
    `.trim();

    const htmlBody = `
      <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">Extrato de Conta Corrente</h2>
        <p style="font-size: 14px; color: #64748b;">Posição comercial para <strong>${company.tradeName}</strong></p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <div style="margin-bottom: 8px; font-size: 14px;"><strong>Saldo em Aberto:</strong> <span style="font-size: 16px; font-weight: bold; color: ${balances.currentBalanceCents > 0 ? '#b91c1c' : '#15803d'};">${fmtEur(balances.currentBalanceCents)}</span></div>
          <div style="font-size: 14px;"><strong>Saldo Vencido:</strong> <span style="font-weight: bold; color: #ea580c;">${fmtEur(balances.overdueBalanceCents)}</span></div>
        </div>

        ${notes ? `<p style="font-size: 14px; line-height: 1.5;">${notes.replace(/\n/g, '<br>')}</p>` : ''}

        <div style="margin-top: 30px; padding: 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 11px; color: #92400e;">
          <strong>Aviso Regulamentar:</strong> Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal.
        </div>
      </div>
    `;

    const mailService = new TenantMailService(this.tenantId, this.db);
    const result = await mailService.send(
      {
        to: targetEmail,
        subject,
        text: textBody,
        html: htmlBody,
        context: 'crm.statement',
        relatedType: 'CrmAccountStatement',
        relatedId: companyId
      },
      actor
    );

    try {
      await this.createActivity({
        type: 'NOTE',
        subject: `Extrato enviado por email para ${targetEmail}`,
        content: `Extrato de conta corrente enviado com sucesso. Saldo informado: ${fmtEur(balances.currentBalanceCents)}.`,
        companyId,
        createdByUserId: actor.userId
      });
    } catch {
      // Ignorar falha secundária
    }

    return result;
  }

  // =========================================================================
  // FASE B8 — PAINEL EXECUTIVO & RELATÓRIOS DO CRM COM GRÁFICOS SVG NATIVOS
  // =========================================================================

  public static sanitizeCsvCell(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    // Prevenção rigorosa contra CSV Formula Injection (Excel / LibreOffice / Google Sheets)
    // Se o valor começa por '=', '+', '-', '@', '\t', '\r', prefixamos com plica/apóstrofo
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    if (/[",\n\r]/.test(str)) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  public async getExecutiveDashboard(filters?: {
    from?: string | Date;
    to?: string | Date;
    assignedUserId?: string;
  }) {
    // 1. Oportunidades do tenant
    const oppWhere: any = {
      tenantId: this.tenantId,
      deletedAt: null
    };
    if (filters?.assignedUserId) {
      oppWhere.assignedUserId = filters.assignedUserId;
    }
    if (filters?.from || filters?.to) {
      oppWhere.createdAt = {};
      if (filters?.from) oppWhere.createdAt.gte = new Date(filters.from);
      if (filters?.to) oppWhere.createdAt.lte = new Date(filters.to);
    }

    const opportunities = await this.db.opportunity.findMany({
      where: oppWhere,
      include: {
        company: {
          select: { id: true, tradeName: true, originSource: true }
        },
        communications: {
          where: { deletedAt: null }
        }
      }
    });

    // Pipeline por estágio
    const stages = ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
    const pipelineByStage: Record<string, { stage: string; count: number; totalValueCents: number; weightedValueCents: number }> = {};
    for (const s of stages) {
      pipelineByStage[s] = { stage: s, count: 0, totalValueCents: 0, weightedValueCents: 0 };
    }

    let wonCount = 0;
    let lostCount = 0;
    let totalWonCycleDays = 0;
    const dealsWithoutNextStep: any[] = [];
    const monthlyForecastMap: Record<string, { month: string; count: number; totalValueCents: number; weightedValueCents: number }> = {};
    const leadSourceMap: Record<string, { source: string; count: number; totalValueCents: number }> = {};

    for (const opp of opportunities) {
      const valCents = Math.round(Number(opp.estimatedValue || 0) * 100);
      const prob = Number(opp.probability ?? 0);
      const weightedCents = Math.round((valCents * prob) / 100);

      const stg = opp.stage || 'QUALIFICATION';
      if (pipelineByStage[stg]) {
        pipelineByStage[stg].count += 1;
        pipelineByStage[stg].totalValueCents += valCents;
        pipelineByStage[stg].weightedValueCents += weightedCents;
      }

      // Win rate e sales cycle
      if (stg === 'WON') {
        wonCount++;
        const createdAtTime = new Date(opp.createdAt).getTime();
        const updatedAtTime = new Date(opp.updatedAt || opp.createdAt).getTime();
        const cycleDays = Math.max(0, Math.round((updatedAtTime - createdAtTime) / (1000 * 60 * 60 * 24)));
        totalWonCycleDays += cycleDays;
      } else if (stg === 'LOST') {
        lostCount++;
      } else {
        // Negócios abertos: previsão mensal
        const closeDate = opp.expectedCloseDate ? new Date(opp.expectedCloseDate) : new Date();
        const monthKey = `${closeDate.getFullYear()}-${String(closeDate.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyForecastMap[monthKey]) {
          monthlyForecastMap[monthKey] = { month: monthKey, count: 0, totalValueCents: 0, weightedValueCents: 0 };
        }
        monthlyForecastMap[monthKey].count += 1;
        monthlyForecastMap[monthKey].totalValueCents += valCents;
        monthlyForecastMap[monthKey].weightedValueCents += weightedCents;

        // Deteção de negócio sem próximo passo:
        // Não possui nenhuma comunicação pendente agendada
        const hasPendingTask = (opp.communications || []).some((c: any) => c.status === 'PENDING');
        if (!hasPendingTask) {
          dealsWithoutNextStep.push({
            id: opp.id,
            title: opp.title,
            companyName: opp.company?.tradeName || 'Sem empresa',
            stage: opp.stage,
            valueCents: valCents,
            expectedCloseDate: opp.expectedCloseDate
          });
        }
      }

      // Origem do cliente / lead
      const origin = opp.company?.originSource || 'OUTRO';
      if (!leadSourceMap[origin]) {
        leadSourceMap[origin] = { source: origin, count: 0, totalValueCents: 0 };
      }
      leadSourceMap[origin].count += 1;
      leadSourceMap[origin].totalValueCents += valCents;
    }

    const closedTotal = wonCount + lostCount;
    const winRatePercent = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 1000) / 10 : 0;
    const avgSalesCycleDays = wonCount > 0 ? Math.round((totalWonCycleDays / wonCount) * 10) / 10 : 0;

    const monthlyForecast = Object.values(monthlyForecastMap).sort((a, b) => a.month.localeCompare(b.month)).slice(0, 6);
    const leadSources = Object.values(leadSourceMap).sort((a, b) => b.totalValueCents - a.totalValueCents);

    // 2. Métricas de Propostas
    const proposals = await this.db.proposal.findMany({
      where: { tenantId: this.tenantId, deletedAt: null },
      select: { id: true, status: true, totalCents: true, acceptedAt: true, rejectedAt: true }
    });

    const totalProposalsCount = proposals.length;
    let acceptedProposalsCount = 0;
    let rejectedProposalsCount = 0;
    let sentProposalsCount = 0;
    let draftProposalsCount = 0;
    let totalProposalVolumeCents = 0;
    let acceptedProposalVolumeCents = 0;

    for (const p of proposals) {
      totalProposalVolumeCents += p.totalCents;
      if (p.status === 'ACCEPTED') {
        acceptedProposalsCount++;
        acceptedProposalVolumeCents += p.totalCents;
      } else if (p.status === 'REJECTED') {
        rejectedProposalsCount++;
      } else if (p.status === 'SENT') {
        sentProposalsCount++;
      } else if (p.status === 'DRAFT') {
        draftProposalsCount++;
      }
    }

    const proposalDecisionTotal = acceptedProposalsCount + rejectedProposalsCount;
    const proposalAcceptanceRatePercent = proposalDecisionTotal > 0
      ? Math.round((acceptedProposalsCount / proposalDecisionTotal) * 1000) / 10
      : 0;

    // 3. Tarefas & Follow-ups
    const activities = await this.db.communication.findMany({
      where: { tenantId: this.tenantId, deletedAt: null, status: 'PENDING' },
      select: { id: true, dueDate: true, priority: true }
    });

    let overdueTasksCount = 0;
    let todayTasksCount = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    for (const act of activities) {
      if (act.dueDate) {
        const d = new Date(act.dueDate);
        if (d < startOfToday) {
          overdueTasksCount++;
        } else if (d <= endOfToday) {
          todayTasksCount++;
        }
      }
    }

    // 4. Posição Financeira da Conta Corrente (B7)
    const accountSummary = await this.getGlobalAccountSummary();

    return {
      pipeline: {
        stages: Object.values(pipelineByStage),
        totalOpenValueCents:
          pipelineByStage.QUALIFICATION.totalValueCents +
          pipelineByStage.PROPOSAL.totalValueCents +
          pipelineByStage.NEGOTIATION.totalValueCents,
        totalWeightedValueCents:
          pipelineByStage.QUALIFICATION.weightedValueCents +
          pipelineByStage.PROPOSAL.weightedValueCents +
          pipelineByStage.NEGOTIATION.weightedValueCents
      },
      efficiency: {
        wonCount,
        lostCount,
        winRatePercent,
        avgSalesCycleDays
      },
      forecast: monthlyForecast,
      leadSources,
      proposals: {
        totalCount: totalProposalsCount,
        draftCount: draftProposalsCount,
        sentCount: sentProposalsCount,
        acceptedCount: acceptedProposalsCount,
        rejectedCount: rejectedProposalsCount,
        acceptanceRatePercent: proposalAcceptanceRatePercent,
        totalVolumeCents: totalProposalVolumeCents,
        acceptedVolumeCents: acceptedProposalVolumeCents
      },
      tasks: {
        pendingCount: activities.length,
        overdueCount: overdueTasksCount,
        todayCount: todayTasksCount
      },
      account: {
        totalReceivableCents: accountSummary.totalReceivableCents,
        totalOverdueCents: accountSummary.totalOverdueCents,
        debtorsCount: accountSummary.companiesWithDebtCount,
        criticalCount: accountSummary.companiesOverdueCount
      },
      dealsWithoutNextStep: {
        count: dealsWithoutNextStep.length,
        items: dealsWithoutNextStep.slice(0, 10)
      }
    };
  }

  public async exportCompaniesCsv(filters?: any): Promise<string> {
    const where: any = { tenantId: this.tenantId, deletedAt: null };
    if (filters?.status) where.status = filters.status;

    const companies = await this.db.company.findMany({
      where,
      orderBy: { tradeName: 'asc' }
    });

    const headers = [
      'ID',
      'Nome Comercial',
      'Firma Juridica',
      'NIF',
      'Estado',
      'Pais',
      'Cidade',
      'Email',
      'Telefone',
      'Setor',
      'Origem',
      'Data Criacao'
    ];

    const rows = companies.map((c: any) => [
      c.id,
      c.tradeName,
      c.legalName || '',
      c.taxNumber || '',
      c.status,
      c.country || 'Portugal',
      c.city || '',
      c.email || '',
      c.phone || '',
      c.sector || '',
      c.originSource || '',
      c.createdAt ? new Date(c.createdAt).toISOString() : ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map((r: any[]) => r.map((cell) => EnterpriseCRMService.sanitizeCsvCell(cell)).join(';'))
    ].join('\r\n');

    return '\uFEFF' + csvContent; // UTF-8 BOM para compatibilidade com Excel
  }

  public async exportDealsCsv(filters?: any): Promise<string> {
    const where: any = { tenantId: this.tenantId, deletedAt: null };
    if (filters?.stage) where.stage = filters.stage;

    const opportunities = await this.db.opportunity.findMany({
      where,
      include: {
        company: { select: { tradeName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const headers = [
      'ID',
      'Titulo Negocio',
      'Empresa',
      'Estagio',
      'Valor Estimado (EUR)',
      'Probabilidade (%)',
      'Valor Ponderado (EUR)',
      'Data Esperada Fecho',
      'Motivo Perda',
      'Data Criacao'
    ];

    const rows = opportunities.map((o: any) => {
      const valEur = Number(o.estimatedValue || 0).toFixed(2);
      const prob = Number(o.probability || 0);
      const weightedEur = (Number(o.estimatedValue || 0) * (prob / 100)).toFixed(2);
      return [
        o.id,
        o.title,
        o.company?.tradeName || '',
        o.stage,
        valEur,
        prob,
        weightedEur,
        o.expectedCloseDate ? new Date(o.expectedCloseDate).toISOString().split('T')[0] : '',
        o.lostReason || '',
        o.createdAt ? new Date(o.createdAt).toISOString() : ''
      ];
    });

    const csvContent = [
      headers.join(';'),
      ...rows.map((r: any[]) => r.map((cell) => EnterpriseCRMService.sanitizeCsvCell(cell)).join(';'))
    ].join('\r\n');

    return '\uFEFF' + csvContent;
  }

  public async exportProposalsCsv(filters?: any): Promise<string> {
    const where: any = { tenantId: this.tenantId, deletedAt: null };
    if (filters?.status) where.status = filters.status;

    const proposals = await this.db.proposal.findMany({
      where,
      include: {
        company: { select: { tradeName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const headers = [
      'ID',
      'Numero Proposta',
      'Titulo',
      'Empresa',
      'Estado',
      'Data Emissao',
      'Validade',
      'Subtotal (EUR)',
      'IVA (EUR)',
      'Total (EUR)',
      'Data Envio',
      'Data Aceitacao'
    ];

    const rows = proposals.map((p: any) => [
      p.id,
      p.proposalNumber,
      p.title,
      p.company?.tradeName || '',
      p.status,
      p.issueDate ? new Date(p.issueDate).toISOString().split('T')[0] : '',
      p.validUntil ? new Date(p.validUntil).toISOString().split('T')[0] : '',
      (p.subtotalCents / 100).toFixed(2),
      (p.vatCents / 100).toFixed(2),
      (p.totalCents / 100).toFixed(2),
      p.sentAt ? new Date(p.sentAt).toISOString() : '',
      p.acceptedAt ? new Date(p.acceptedAt).toISOString() : ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map((r: any[]) => r.map((cell) => EnterpriseCRMService.sanitizeCsvCell(cell)).join(';'))
    ].join('\r\n');

    return '\uFEFF' + csvContent;
  }

  public async exportAccountEntriesCsv(filters?: any): Promise<string> {
    const where: any = { tenantId: this.tenantId };
    if (filters?.companyId) where.companyId = filters.companyId;

    const entries = await this.db.crmAccountEntry.findMany({
      where,
      include: {
        company: { select: { tradeName: true, taxNumber: true } }
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }]
    });

    const headers = [
      'ID',
      'Data Movimento',
      'Empresa',
      'NIF',
      'Tipo',
      'Doc Externo Faturacao',
      'Data Vencimento',
      'Montante (EUR)',
      'Metodo Pagamento',
      'Referencia',
      'Estornado',
      'Data Estorno',
      'Notas',
      'Aviso Legal'
    ];

    const rows = entries.map((e: any) => [
      e.id,
      e.entryDate ? new Date(e.entryDate).toISOString().split('T')[0] : '',
      e.company?.tradeName || '',
      e.company?.taxNumber || '',
      e.type,
      e.externalDocumentNumber || '',
      e.dueDate ? new Date(e.dueDate).toISOString().split('T')[0] : '',
      (e.amountCents / 100).toFixed(2),
      e.method || '',
      e.reference || '',
      e.isReversed ? 'SIM' : 'NAO',
      e.reversedAt ? new Date(e.reversedAt).toISOString() : '',
      e.notes || '',
      'Registo informativo de software de faturacao certificado. O HelderLabs CRM nao emite faturas.'
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map((r: any[]) => r.map((cell) => EnterpriseCRMService.sanitizeCsvCell(cell)).join(';'))
    ].join('\r\n');

    return '\uFEFF' + csvContent;
  }
}


