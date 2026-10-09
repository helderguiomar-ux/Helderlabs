import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { EnterpriseCRMService } from '../services/EnterpriseCRMService';

export interface CRMRequestContext {
  tenantId: string;
  userId?: string;
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

  async getCompaniesMetrics(context: CRMRequestContext) {
    return serviceFor(context).getCompaniesMetrics();
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
  // DOCUMENTOS & COMPLIANCE (FASE B6)
  // =========================================================================

  async listCompanyDocuments(context: CRMRequestContext, companyId: string, options?: any) {
    return serviceFor(context).listCompanyDocuments(companyId, options);
  }

  async listTenantDocuments(context: CRMRequestContext, options?: any) {
    return serviceFor(context).listTenantDocuments(options);
  }

  async getDocument(context: CRMRequestContext, docId: string) {
    return serviceFor(context).getCompanyDocumentById(docId);
  }

  async addCompanyDocument(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).addCompanyDocument(companyId, {
      ...data,
      uploadedBy: context.userId
    });
  }

  async updateCompanyDocument(context: CRMRequestContext, docId: string, data: any) {
    return serviceFor(context).updateCompanyDocument(docId, data, context.userId);
  }

  async verifyCompanyDocument(context: CRMRequestContext, docId: string, options: { status: 'VERIFIED' | 'REJECTED'; notes?: string | null }) {
    return serviceFor(context).verifyCompanyDocument(docId, options, context.userId);
  }

  async deleteCompanyDocument(context: CRMRequestContext, docId: string) {
    return serviceFor(context).deleteCompanyDocument(docId, context.userId);
  }

  async listContracts(context: CRMRequestContext, options?: any) {
    return serviceFor(context).listContracts(options);
  }

  async getContract(context: CRMRequestContext, contractId: string) {
    return serviceFor(context).getContractById(contractId);
  }

  async createContract(context: CRMRequestContext, firstArg: string | any, data?: any) {
    return serviceFor(context).createContract(firstArg, data);
  }

  async updateContract(context: CRMRequestContext, contractId: string, data: any) {
    return serviceFor(context).updateContract(contractId, data);
  }

  async renewContract(context: CRMRequestContext, contractId: string, options?: any) {
    return serviceFor(context).renewContract(contractId, options, context.userId);
  }

  async terminateContract(context: CRMRequestContext, contractId: string, options: { reason: string; cancelledAt?: string }) {
    return serviceFor(context).terminateContract(contractId, options, context.userId);
  }

  async deleteContract(context: CRMRequestContext, contractId: string) {
    return serviceFor(context).deleteContract(contractId);
  }

  async renderContractSummaryHtml(context: CRMRequestContext, contractId: string) {
    return serviceFor(context).renderContractSummaryHtml(contractId);
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
  // PIPELINE COMERCIAL & FUNIL KANBAN (FASE B2)
  // =========================================================================

  async getPipelineKanban(context: CRMRequestContext, filters?: { assignedUserId?: string }) {
    return serviceFor(context).getPipelineKanban(filters);
  }

  async createOpportunity(context: CRMRequestContext, data: any) {
    return serviceFor(context).createOpportunity(data);
  }

  async updateOpportunityStage(context: CRMRequestContext, opportunityId: string, data: any) {
    return serviceFor(context).updateOpportunityStage(opportunityId, data.stage, data);
  }

  async updateOpportunity(context: CRMRequestContext, opportunityId: string, data: any) {
    return serviceFor(context).updateOpportunity(opportunityId, data);
  }

  async deleteOpportunity(context: CRMRequestContext, opportunityId: string) {
    return serviceFor(context).deleteOpportunity(opportunityId);
  }

  async convertLead(context: CRMRequestContext, leadId: string, estimatedValue: number, options?: any) {
    return serviceFor(context).convertLeadToOpportunity(leadId, estimatedValue, options);
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

  // =========================================================================
  // ATIVIDADES, TAREFAS & TIMELINE (FASE B3)
  // =========================================================================

  async listActivities(context: CRMRequestContext, filters?: any) {
    return serviceFor(context).listActivities(filters);
  }

  async getPendingActivities(context: CRMRequestContext) {
    return serviceFor(context).getPendingActivitiesSummary();
  }

  async createActivity(context: CRMRequestContext, data: any) {
    return serviceFor(context).createActivity({
      ...data,
      createdByUserId: context.userId
    });
  }

  async completeActivity(context: CRMRequestContext, id: string, notes?: string) {
    return serviceFor(context).completeActivity(id, notes);
  }

  async updateActivity(context: CRMRequestContext, id: string, data: any) {
    return serviceFor(context).updateActivity(id, data);
  }

  async deleteActivity(context: CRMRequestContext, id: string) {
    return serviceFor(context).deleteActivity(id);
  }

  // =========================================================================
  // PROPOSTAS COMERCIAIS & ORÇAMENTOS (FASE B4)
  // =========================================================================

  async listProposals(context: CRMRequestContext, filters?: any) {
    return serviceFor(context).listProposals(filters);
  }

  async getProposal(context: CRMRequestContext, id: string) {
    return serviceFor(context).getProposalById(id);
  }

  async createProposal(context: CRMRequestContext, data: any) {
    return serviceFor(context).createProposal(data);
  }

  async updateProposal(context: CRMRequestContext, id: string, data: any) {
    return serviceFor(context).updateProposal(id, data);
  }

  async deleteProposal(context: CRMRequestContext, id: string) {
    return serviceFor(context).deleteProposal(id);
  }

  async updateProposalStatus(context: CRMRequestContext, id: string, status: any, reason?: string) {
    return serviceFor(context).updateProposalStatus(id, status, reason);
  }

  async sendProposalEmail(context: CRMRequestContext, id: string, options: any, actor: any) {
    return serviceFor(context).sendProposalEmail(id, options, actor);
  }

  async renderProposalHtml(context: CRMRequestContext, id: string) {
    return serviceFor(context).renderProposalHtml(id);
  }

  // =========================================================================
  // CONTA CORRENTE DE CLIENTES (FASE B7)
  // =========================================================================

  async createAccountEntry(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).createAccountEntry(companyId, data, context.userId);
  }

  async createReversal(context: CRMRequestContext, entryId: string, reason: string) {
    return serviceFor(context).createReversal(entryId, reason, context.userId);
  }

  async allocatePayment(context: CRMRequestContext, companyId: string, data: any) {
    return serviceFor(context).allocatePayment(
      companyId,
      data.paymentEntryId,
      data.documentEntryId,
      data.amountCents,
      context.userId
    );
  }

  async getCustomerStatement(context: CRMRequestContext, companyId: string, filters?: any) {
    return serviceFor(context).getCustomerStatement(companyId, filters);
  }

  async getCustomerBalances(context: CRMRequestContext, companyId: string) {
    return serviceFor(context).getCustomerBalances(companyId);
  }

  async getGlobalAccountSummary(context: CRMRequestContext) {
    return serviceFor(context).getGlobalAccountSummary();
  }

  async renderStatementHtml(context: CRMRequestContext, companyId: string, filters?: any) {
    return serviceFor(context).renderStatementHtml(companyId, filters);
  }

  async sendStatementEmail(context: CRMRequestContext, companyId: string, options: any, actor: any) {
    return serviceFor(context).sendStatementEmail(companyId, options.to, actor, options.notes);
  }
}

