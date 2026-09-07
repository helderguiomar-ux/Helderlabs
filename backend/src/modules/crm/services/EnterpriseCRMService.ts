import type { TenantScopedPrismaClient } from '../../../database/prisma/tenantScopedClient';
import { prisma as defaultPrismaClient } from '../../../database/prisma/client';

export class EnterpriseCRMService {
  // tenantId vem sempre do JWT autenticado (ver src/plugins/authenticate.ts
  // e crm.routes.ts) — nunca de query/body. `db` é injetado por construtor
  // para permitir testar a lógica de negócio com um Prisma "fake" em
  // memória (ver tests/crm/), sem precisar de uma base de dados real. Em
  // produção, `db` é o client já "amarrado" ao tenant por
  // `forTenant(tenantId)` (Prisma Client Extension) — por isso o
  // `tenantId` explícito abaixo é uma segunda camada (defesa em
  // profundidade), não a única.
  constructor(
    private readonly tenantId: string,
    private readonly db: TenantScopedPrismaClient | any = defaultPrismaClient
  ) {}

  /**
   * Fluxo: Lead -> Qualification -> Opportunity -> Proposal -> Negotiation -> Won -> Customer
   */
  public async convertLeadToOpportunity(leadId: string, estimatedValue: number) {
    // where inclui tenantId — antes só filtrava por id, o que permitia (em
    // teoria) converter uma Lead de outro tenant desde que se soubesse o
    // seu id. Corrigido aqui como parte do trabalho de multi-tenancy.
    const lead = await this.db.lead.findUnique({ where: { id: leadId, tenantId: this.tenantId } as any });
    if (!lead) throw new Error('Lead não encontrada.');

    // 1. Atualizar Lead para QUALIFICATION
    await this.db.lead.update({
      where: { id: leadId },
      data: { status: 'QUALIFICATION' }
    });

    // 2. Criar Opportunity associada
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

  /**
   * Mover Opportunity para WON e converter em Customer mantendo histórico completo
   */
  public async winOpportunityAndCreateCustomer(opportunityId: string) {
    const opp = await this.db.opportunity.findUnique({
      where: { id: opportunityId, tenantId: this.tenantId } as any,
      include: { lead: true }
    });

    if (!opp) throw new Error('Oportunidade não encontrada.');

    // 1. Criar Registo Customer
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

    // 2. Mover Oportunidade para WON e associar ao Customer
    await this.db.opportunity.update({
      where: { id: opportunityId },
      data: {
        stage: 'WON',
        customerId: customer.id
      }
    });

    // 3. Vincular Histórico de Comunicações da Lead ao novo Cliente
    if (opp.leadId) {
      await this.db.communication.updateMany({
        where: { leadId: opp.leadId },
        data: { customerId: customer.id }
      });
    }

    return customer;
  }

  /**
   * Criar uma nova Lead (entrada manual, ex.: a partir do frontend)
   */
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

  /**
   * Obter Indicadores Avançados para o Dashboard Comercial
   */
  public async getAdvancedDashboardMetrics() {
    const [leads, opportunities, customers] = await Promise.all([
      this.db.lead.findMany({ where: { tenantId: this.tenantId } }),
      this.db.opportunity.findMany({ where: { tenantId: this.tenantId } }),
      this.db.customer.findMany({ where: { tenantId: this.tenantId } })
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

    // Agrupamento por Origem
    const leadsBySource: Record<string, number> = {};
    leads.forEach((l: any) => {
      leadsBySource[l.source] = (leadsBySource[l.source] || 0) + 1;
    });

    return {
      pipelineValue,
      expectedRevenue,
      totalLeads: leads.length,
      activeOpportunities: opportunities.filter((o: any) => o.stage !== 'WON' && o.stage !== 'LOST').length,
      activeCustomers: customers.length,
      conversionRate,
      leadsBySource
    };
  }
}
