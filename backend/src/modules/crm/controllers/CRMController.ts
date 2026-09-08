import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { EnterpriseCRMService } from '../services/EnterpriseCRMService';

export interface CRMRequestContext {
  tenantId: string;
  db: TenantScopedPrismaClient;
}

function serviceFor(context: CRMRequestContext) {
  return new EnterpriseCRMService(context.tenantId, context.db);
}

export class CRMController {
  // =========================================================================
  // EMPRESAS 360º
  // =========================================================================

  async listCompanies(context: CRMRequestContext, filters?: any) {
    return serviceFor(context).listCompanies(filters);
  }

  async getCompany360(context: CRMRequestContext, id: string) {
    return serviceFor(context).getCompany360(id);
  }

  async createCompany(context: CRMRequestContext, data: any) {
    return serviceFor(context).createCompany(data);
  }

  async updateCompany(context: CRMRequestContext, id: string, data: any) {
    return serviceFor(context).updateCompany(id, data);
  }

  async deleteCompany(context: CRMRequestContext, id: string) {
    return serviceFor(context).deleteCompany(id);
  }

  async restoreCompany(context: CRMRequestContext, id: string) {
    return serviceFor(context).restoreCompany(id);
  }

  // =========================================================================
  // CONTACTOS & ENDEREÇOS
  // =========================================================================

  async addCompanyContact(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).addCompanyContact(companyId, data);
  }

  async updateCompanyContact(context: CRMRequestContext, contactId: string, data: any) {
    return serviceFor(context).updateCompanyContact(contactId, data);
  }

  async deleteCompanyContact(context: CRMRequestContext, contactId: string) {
    return serviceFor(context).deleteCompanyContact(contactId);
  }

  async addCompanyAddress(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).addCompanyAddress(companyId, data);
  }

  async deleteCompanyAddress(context: CRMRequestContext, addressId: string) {
    return serviceFor(context).deleteCompanyAddress(addressId);
  }

  // =========================================================================
  // DOCUMENTOS & CONTRATOS
  // =========================================================================

  async addCompanyDocument(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).addCompanyDocument(companyId, data);
  }

  async deleteCompanyDocument(context: CRMRequestContext, docId: string) {
    return serviceFor(context).deleteCompanyDocument(docId);
  }

  async listContracts(context: CRMRequestContext, companyId?: string) {
    return serviceFor(context).listContracts(companyId);
  }

  async createContract(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).createContract(companyId, data);
  }

  async updateContract(context: CRMRequestContext, contractId: string, data: any) {
    return serviceFor(context).updateContract(contractId, data);
  }

  async deleteContract(context: CRMRequestContext, contractId: string) {
    return serviceFor(context).deleteContract(contractId);
  }

  // =========================================================================
  // RELAÇÕES SOCIETÁRIAS
  // =========================================================================

  async addCompanyRelation(context: CRMRequestContext, fromCompanyId: string, toCompanyId: string, relationType: string, notes?: string) {
    return serviceFor(context).addCompanyRelation(fromCompanyId, toCompanyId, relationType, notes);
  }

  async deleteCompanyRelation(context: CRMRequestContext, relationId: string) {
    return serviceFor(context).deleteCompanyRelation(relationId);
  }

  // =========================================================================
  // PIPELINE & DASHBOARD (COMPATIBILIDADE LEADS/OPPORTUNITIES)
  // =========================================================================

  async convertLead(context: CRMRequestContext, leadId: string, estimatedValue: number) {
    return serviceFor(context).convertLeadToOpportunity(leadId, estimatedValue);
  }

  async winOpportunity(context: CRMRequestContext, opportunityId: string) {
    return serviceFor(context).winOpportunityAndCreateCustomer(opportunityId);
  }

  async dashboardMetrics(context: CRMRequestContext) {
    return serviceFor(context).getAdvancedDashboardMetrics();
  }

  async createLead(
    context: CRMRequestContext,
    data: {
      company: string;
      name: string;
      email?: string;
      phone?: string;
      source: string;
    }
  ) {
    return serviceFor(context).createLead(data);
  }

  async listLeads(context: CRMRequestContext) {
    return serviceFor(context).listLeads();
  }

  async updateLead(context: CRMRequestContext, id: string, data: any) {
    return serviceFor(context).updateLead(id, data);
  }

  async deleteLead(context: CRMRequestContext, id: string) {
    return serviceFor(context).deleteLead(id);
  }

  async listOpportunities(context: CRMRequestContext) {
    return serviceFor(context).listOpportunities();
  }

  async listCustomers(context: CRMRequestContext) {
    return serviceFor(context).listCustomers();
  }
}
