import type { PrismaClient } from '@prisma/client';
import { EnterpriseCRMService } from '../services/EnterpriseCRMService';

// O contexto é sempre derivado de request.user/request.db (preenchidos pelo
// hook app.authenticate) — nunca de query/body. Ver crm.routes.ts.
export interface CRMRequestContext {
  tenantId: string;
  db: PrismaClient;
}

function serviceFor(context: CRMRequestContext) {
  return new EnterpriseCRMService(context.tenantId, context.db);
}

export class CRMController {
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

  async listOpportunities(context: CRMRequestContext) {
    return serviceFor(context).listOpportunities();
  }

  async listCustomers(context: CRMRequestContext) {
    return serviceFor(context).listCustomers();
  }
}
