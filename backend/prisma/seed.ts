/**
 * Seed de desenvolvimento — cria dados fictícios cobrindo os 4 cenários de tenant.
 * USO: npm run seed
 * NUNCA executar em produção.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed não pode ser executado em produção!");
  }
  console.log("HelderLabs ERP -- Seed de desenvolvimento (Fase 0.5)\n");

  // Limpar dados existentes (ordem respeita FK constraints)
  console.log("A limpar dados existentes...");
  await prisma.applicationAssignment.deleteMany({});
  await prisma.applicationInstance.deleteMany({});
  await prisma.userActivity.deleteMany({});
  await prisma.communication.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.fee.deleteMany({});
  await prisma.vote.deleteMany({});
  await prisma.assembly.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.unit.deleteMany({});
  await prisma.building.deleteMany({});
  await prisma.opportunity.deleteMany({});
  await prisma.lead.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.accountRequest.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.impersonationSession.deleteMany({});
  await prisma.rolePermission.deleteMany({});
  await prisma.permission.deleteMany({});
  await prisma.tenantSetting.deleteMany({});
  await prisma.tenantBranding.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});
  await prisma.module.deleteMany({});
  await prisma.platformSetting.deleteMany({});
  console.log("Dados limpos.\n");

  // 1. Módulos disponíveis na plataforma
  console.log("A criar módulos da plataforma...");
  const [modCrm, modCondominios, modFinance, modInvoicing, modSales, modTasks] = await Promise.all([
    prisma.module.create({
      data: { key: "crm", name: "CRM", description: "Gestão de Leads, Oportunidades e Clientes", icon: "users", color: "#0d419f", category: "Comercial", sortOrder: 10, isActive: true }
    }),
    prisma.module.create({
      data: { key: "condominios", name: "Condomínios", description: "Gestão de edifícios, frações e assembleias", icon: "building", color: "#2563eb", category: "Operações", sortOrder: 20, isActive: true }
    }),
    prisma.module.create({
      data: { key: "finance", name: "Financeiro", description: "Contas a pagar/receber e tesouraria", icon: "wallet", color: "#059669", category: "Financeiro", sortOrder: 30, isActive: true }
    }),
    prisma.module.create({
      data: { key: "invoicing", name: "Faturação", description: "Faturação e documentos fiscais", icon: "receipt", color: "#d97706", category: "Financeiro", sortOrder: 40, isActive: false }
    }),
    prisma.module.create({
      data: { key: "sales", name: "Vendas Pro", description: "Pipeline de vendas avançado", icon: "trending-up", color: "#7c3aed", category: "Comercial", sortOrder: 50, isActive: false }
    }),
    prisma.module.create({
      data: { key: "tasks", name: "Projetos & Tarefas", description: "Gestão de tarefas e projetos", icon: "check-square", color: "#4b5563", category: "Operações", sortOrder: 60, isActive: false }
    }),
  ]);
  console.log("6 módulos criados.\n");

  const pwHash = await bcrypt.hash("admin1234", 10);

  // ------------------------------------------------------------------------
  // Tenant 0: System Tenant (HelderLabs Platform System - SUPER ADMIN)
  // ------------------------------------------------------------------------
  console.log("A criar Tenant 0 (System): HelderLabs Platform System...");
  const tenantPlatform = await prisma.tenant.create({
    data: { name: "HelderLabs Platform System", slug: "helderlabs-platform", email: "helderguiomar@gmail.com", phone: "+351 910 000 000", address: "HelderLabs HQ", city: "Lisboa", country: "Portugal", status: "ACTIVE" }
  });
  await prisma.tenantBranding.create({
    data: { tenantId: tenantPlatform.id, displayName: "HelderLabs Platform", legalName: "HelderLabs Systems", primaryColor: "#0d419f", accentColor: "#1f6feb", theme: "dark", currency: "EUR", country: "PT" }
  });
  const superAdminUser = await prisma.user.create({
    data: { tenantId: tenantPlatform.id, name: "Helder Guiomar (Super Admin)", email: "helderguiomar@gmail.com", passwordHash: pwHash, role: "SUPER_ADMIN", status: "ACTIVE", active: true, authProvider: "EMAIL" }
  });
  const allModules = [modCrm, modCondominios, modFinance, modInvoicing, modSales, modTasks];
  for (const m of allModules) {
    const appInst = await prisma.applicationInstance.create({
      data: { moduleId: m.id, tenantId: tenantPlatform.id, status: "ACTIVE", config: { unlimited: true }, createdBy: superAdminUser.id }
    });
    await prisma.applicationAssignment.create({
      data: { userId: superAdminUser.id, applicationId: appInst.id, roleInApp: "ADMIN", status: "ACTIVE" }
    });
  }

  // ------------------------------------------------------------------------
  // Tenant 1: Consultoria Alfa (ACTIVE CRM + Finance TRIAL a expirar em 3 dias + Limite de consumo perto do topo)
  // ------------------------------------------------------------------------
  console.log("A criar Tenant 1: Consultoria Alfa (CRM ACTIVE + Finance TRIAL)...");
  const tenantAlfa = await prisma.tenant.create({
    data: { name: "Consultoria Alfa, Lda.", slug: "consultoria-alfa", email: "geral@consultoria-alfa.pt", phone: "+351 210 000 001", address: "Av. da Liberdade, 100", city: "Lisboa", postalCode: "1250-096", country: "Portugal", status: "ACTIVE" }
  });
  await prisma.tenantBranding.create({
    data: { tenantId: tenantAlfa.id, displayName: "Consultoria Alfa", legalName: "Consultoria Alfa, Lda.", primaryColor: "#0d419f", accentColor: "#1f6feb", theme: "system", currency: "EUR", country: "PT" }
  });

  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const [alfaAdmin, alfaSales1, alfaSales2, alfaPending, alfaUnassigned] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Ana Silva (Tenant Admin)", email: "ana@consultoria-alfa.pt", passwordHash: pwHash, role: "TENANT_ADMIN", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Carlos Rodrigues (Vendas)", email: "carlos@consultoria-alfa.pt", passwordHash: pwHash, role: "SALES", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Maria Ferreira (Vendas)", email: "maria@consultoria-alfa.pt", passwordHash: pwHash, role: "SALES", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Pedro Pendente (Pendente)", email: "pedro.pendente@consultoria-alfa.pt", passwordHash: pwHash, role: "USER", status: "PENDING_APPROVAL", active: false, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Nuno SemApp (Sem Atribuição)", email: "nuno.unassigned@consultoria-alfa.pt", passwordHash: pwHash, role: "USER", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
  ]);

  // Instância CRM com quota maxLeads: 5 (temos 4 criadas => perto do topo!)
  const alfaCrmApp = await prisma.applicationInstance.create({
    data: {
      moduleId: modCrm.id,
      tenantId: tenantAlfa.id,
      status: "ACTIVE",
      plan: "ENTERPRISE",
      limits: { maxLeads: 5, maxStorageMB: 1024 },
      config: { leadSources: ["web", "phone", "referral", "email"], currency: "EUR" },
      createdBy: alfaAdmin.id
    }
  });

  // Instância Financeira em TRIAL a expirar em 3 dias
  const alfaFinanceApp = await prisma.applicationInstance.create({
    data: {
      moduleId: modFinance.id,
      tenantId: tenantAlfa.id,
      status: "TRIAL",
      plan: "TRIAL",
      graceDays: 3,
      config: { taxRegime: "PT", currency: "EUR" },
      createdBy: alfaAdmin.id
    }
  });

  await prisma.applicationAssignment.createMany({
    data: [
      { userId: alfaAdmin.id, applicationId: alfaCrmApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
      { userId: alfaAdmin.id, applicationId: alfaFinanceApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
      { userId: alfaSales1.id, applicationId: alfaCrmApp.id, roleInApp: "USER", status: "ACTIVE" },
      { userId: alfaSales2.id, applicationId: alfaCrmApp.id, roleInApp: "USER", status: "ACTIVE" },
    ]
  });

  // 4 Leads criadas (limite maxLeads é 5)
  await Promise.all([
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Tech Ventures SA", name: "Miguel Costa", email: "miguel@techventures.pt", source: "web", status: "NEW", assignedUserId: alfaSales1.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Inova Saúde", name: "Sofia Pinto", email: "sofia@inovasaude.pt", source: "referral", status: "CONTACTED", assignedUserId: alfaSales1.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Grupo Retail XYZ", name: "Pedro Machado", email: "pedro@grupoxyz.pt", source: "phone", status: "QUALIFICATION", assignedUserId: alfaSales2.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "BioTech Porto", name: "Catarina Mendes", email: "catarina@bioporto.pt", source: "email", status: "CONVERTED", assignedUserId: alfaSales2.id } }),
  ]);
  await prisma.opportunity.create({ data: { tenantId: tenantAlfa.id, title: "Implementação ERP - Grupo Retail XYZ", stage: "NEGOTIATION", estimatedValue: 45000, probability: 75, assignedUserId: alfaSales2.id } });
  await prisma.customer.create({ data: { tenantId: tenantAlfa.id, companyName: "BioTech Porto", website: "https://bioporto.pt", assignedUserId: alfaSales2.id } });

  // ------------------------------------------------------------------------
  // Tenant 2: Administra Condo (GRACE)
  // ------------------------------------------------------------------------
  console.log("A criar Tenant 2: Administra Condo (Aplicação em GRACE)...");
  const tenantCondo = await prisma.tenant.create({
    data: { name: "Administra Condo, Lda.", slug: "administra-condo", email: "info@administracondo.pt", phone: "+351 291 100 200", address: "Rua Dr. Fernão Ornelas, 50", city: "Funchal", postalCode: "9050-021", country: "Portugal", status: "ACTIVE" }
  });
  await prisma.tenantBranding.create({
    data: { tenantId: tenantCondo.id, displayName: "Administra Condo", legalName: "Administra Condo, Lda.", primaryColor: "#2563eb", accentColor: "#3b82f6", theme: "light", currency: "EUR", country: "PT" }
  });
  const [condoAdmin, condoGestor] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenantCondo.id, name: "Luísa Freitas (Admin)", email: "luisa@administracondo.pt", passwordHash: pwHash, role: "TENANT_ADMIN", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantCondo.id, name: "Paulo Jardim", email: "paulo@administracondo.pt", passwordHash: pwHash, role: "MANAGER", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
  ]);
  const condoApp = await prisma.applicationInstance.create({
    data: { moduleId: modCondominios.id, tenantId: tenantCondo.id, status: "GRACE", graceDays: 3, config: { defaultPermille: 1000, currency: "EUR", region: "Madeira" }, createdBy: condoAdmin.id }
  });
  await prisma.applicationAssignment.createMany({
    data: [
      { userId: condoAdmin.id, applicationId: condoApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
      { userId: condoGestor.id, applicationId: condoApp.id, roleInApp: "MANAGER", status: "ACTIVE" },
    ]
  });
  const building = await prisma.building.create({ data: { tenantId: tenantCondo.id, name: "Edifício Solar do Atlântico", address: "Rua das Palmeiras, 12", municipality: "Funchal", taxNumber: "500123456", totalPermille: 1000 } });
  const owner = await prisma.owner.create({ data: { name: "António Sousa", email: "antonio@example.pt", phone: "+351 920 000 001" } });
  await prisma.unit.createMany({
    data: [
      { buildingId: building.id, identifier: "Fração A (RC Dto)", permille: 120, ownerId: owner.id },
      { buildingId: building.id, identifier: "Fração B (RC Esq)", permille: 100 },
      { buildingId: building.id, identifier: "Fração C (1 Dto)", permille: 130, ownerId: owner.id },
    ]
  });

  // ------------------------------------------------------------------------
  // Tenant 3: StartUp Inovação (SUSPENDED)
  // ------------------------------------------------------------------------
  console.log("A criar Tenant 3: StartUp Inovação (Estado: SUSPENDED)...");
  const tenantSuspended = await prisma.tenant.create({
    data: { name: "StartUp Inovação, Unip.", slug: "startup-inovacao", email: "hello@startupino.pt", city: "Porto", country: "Portugal", status: "SUSPENDED" }
  });
  await prisma.tenantBranding.create({
    data: { tenantId: tenantSuspended.id, displayName: "StartUp Inovação", legalName: "StartUp Inovação, Unip.", primaryColor: "#7c3aed", accentColor: "#8b5cf6", theme: "system", currency: "EUR", country: "PT" }
  });
  const suspAdmin = await prisma.user.create({
    data: { tenantId: tenantSuspended.id, name: "Beatriz Santos", email: "bea@startupino.pt", passwordHash: pwHash, role: "TENANT_OWNER", status: "ACTIVE", active: true, authProvider: "EMAIL" }
  });
  const suspCrmApp = await prisma.applicationInstance.create({
    data: { moduleId: modCrm.id, tenantId: tenantSuspended.id, status: "SUSPENDED", config: { currency: "EUR" }, createdBy: suspAdmin.id }
  });
  await prisma.applicationAssignment.create({
    data: { userId: suspAdmin.id, applicationId: suspCrmApp.id, roleInApp: "ADMIN", status: "ACTIVE" }
  });

  console.log("===========================================");
  console.log("SEED CONCLUÍDO COM SUCESSO:");
  console.log("  - Tenant 0: HelderLabs Platform (SUPER_ADMIN, 6 Módulos ACTIVE)");
  console.log("  - Tenant 1: Consultoria Alfa (ACTIVE, CRM Quotas Perto do Limite, Finance TRIAL expira em 3d, User Pendente, User SemApp)");
  console.log("  - Tenant 2: Administra Condo (GRACE)");
  console.log("  - Tenant 3: StartUp Inovação (SUSPENDED)");
  console.log("===========================================");
}

main()
  .catch((e) => {
    console.error("Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });