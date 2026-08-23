/**
 * Seed de desenvolvimento — cria dados fictícios para testar todos os módulos.
 * USO: npm run seed
 * NUNCA executar em producao.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed nao pode ser executado em producao!");
  }
  console.log("HelderLabs ERP -- Seed de desenvolvimento\n");

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
  await prisma.rolePermission.deleteMany({});
  await prisma.permission.deleteMany({});
  await prisma.tenantModule.deleteMany({});
  await prisma.tenantSetting.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});
  await prisma.module.deleteMany({});
  await prisma.platformSetting.deleteMany({});
  console.log("Dados limpos.\n");

  // Modulos disponiveis na plataforma
  console.log("A criar modulos da plataforma...");
  const [modCrm, modCondominios, modFinance, modInvoicing, modSales, modTasks] = await Promise.all([
    prisma.module.create({ data: { name: "CRM", description: "Gestao de Leads, Oportunidades e Clientes", isActive: true } }),
    prisma.module.create({ data: { name: "Condominios", description: "Gestao de condominios, fracoes e assembleias", isActive: true } }),
    prisma.module.create({ data: { name: "Finance", description: "Contas a pagar/receber e tesouraria (em desenvolvimento)", isActive: true } }),
    prisma.module.create({ data: { name: "Invoicing", description: "Faturacao e documentos fiscais (em desenvolvimento)", isActive: false } }),
    prisma.module.create({ data: { name: "Sales", description: "Pipeline de vendas avancado (em desenvolvimento)", isActive: false } }),
    prisma.module.create({ data: { name: "Tasks", description: "Gestao de tarefas e projetos (em desenvolvimento)", isActive: false } }),
  ]);
  console.log("6 modulos criados.\n");

  const pwHash = await bcrypt.hash("admin1234", 10);

  // Tenant 1: Empresa de Consultoria (ACTIVE)
  console.log("A criar Tenant 1: Consultoria Alfa...");
  const tenantAlfa = await prisma.tenant.create({
    data: {
      name: "Consultoria Alfa, Lda.", slug: "consultoria-alfa",
      email: "geral@consultoria-alfa.pt", phone: "+351 210 000 001",
      address: "Av. da Liberdade, 100", city: "Lisboa",
      postalCode: "1250-096", country: "Portugal", status: "ACTIVE"
    }
  });
  const [alfaAdmin, alfaSales1, alfaSales2, alfaViewer] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Ana Silva (Admin)", email: "ana@consultoria-alfa.pt", passwordHash: pwHash, role: "TENANT_ADMIN", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Carlos Rodrigues", email: "carlos@consultoria-alfa.pt", passwordHash: pwHash, role: "SALES", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Maria Ferreira", email: "maria@consultoria-alfa.pt", passwordHash: pwHash, role: "SALES", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantAlfa.id, name: "Joao Oliveira (Viewer)", email: "joao@consultoria-alfa.pt", passwordHash: pwHash, role: "READ_ONLY", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
  ]);
  const alfaCrmApp = await prisma.applicationInstance.create({ data: { moduleId: modCrm.id, tenantId: tenantAlfa.id, status: "ACTIVE", config: { leadSources: ["web","phone","referral","email"], currency: "EUR" }, createdBy: alfaAdmin.id } });
  const alfaFinanceApp = await prisma.applicationInstance.create({ data: { moduleId: modFinance.id, tenantId: tenantAlfa.id, status: "TRIAL", config: { taxRegime: "PT", currency: "EUR" }, createdBy: alfaAdmin.id } });
  await prisma.applicationAssignment.createMany({ data: [
    { userId: alfaAdmin.id, applicationId: alfaCrmApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
    { userId: alfaAdmin.id, applicationId: alfaFinanceApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
    { userId: alfaSales1.id, applicationId: alfaCrmApp.id, roleInApp: "USER", status: "ACTIVE" },
    { userId: alfaSales2.id, applicationId: alfaCrmApp.id, roleInApp: "USER", status: "ACTIVE" },
    { userId: alfaViewer.id, applicationId: alfaCrmApp.id, roleInApp: "VIEWER", status: "ACTIVE" },
  ]});
  await Promise.all([
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Tech Ventures SA", name: "Miguel Costa", email: "miguel@techventures.pt", source: "web", status: "NEW", assignedUserId: alfaSales1.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Inova Saude", name: "Sofia Pinto", email: "sofia@inovasaude.pt", source: "referral", status: "CONTACTED", assignedUserId: alfaSales1.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Grupo Retail XYZ", name: "Pedro Machado", email: "pedro@grupoxyz.pt", source: "phone", status: "QUALIFICATION", assignedUserId: alfaSales2.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "BioTech Porto", name: "Catarina Mendes", email: "catarina@bioporto.pt", source: "email", status: "CONVERTED", assignedUserId: alfaSales2.id } }),
    prisma.lead.create({ data: { tenantId: tenantAlfa.id, company: "Logistica Sul", name: "Rui Alves", email: "rui@logisticasul.pt", source: "web", status: "LOST", assignedUserId: alfaSales1.id } }),
  ]);
  await prisma.opportunity.create({ data: { tenantId: tenantAlfa.id, title: "Implementacao ERP - Grupo Retail XYZ", stage: "NEGOTIATION", estimatedValue: 45000, probability: 75, assignedUserId: alfaSales2.id } });
  await prisma.customer.create({ data: { tenantId: tenantAlfa.id, companyName: "BioTech Porto", website: "https://bioporto.pt", assignedUserId: alfaSales2.id } });
  console.log("Consultoria Alfa criada: 4 users, CRM ACTIVE, Finance TRIAL, 5 leads, 1 opp, 1 cliente.\n");

  // Tenant 2: Administradora de Condominios (ACTIVE)
  console.log("A criar Tenant 2: Administra Condo...");
  const tenantCondo = await prisma.tenant.create({
    data: { name: "Administra Condo, Lda.", slug: "administra-condo", email: "info@administracondo.pt", phone: "+351 291 100 200", address: "Rua Dr. Fernao Ornelas, 50", city: "Funchal", postalCode: "9050-021", country: "Portugal", status: "ACTIVE" }
  });
  const [condoAdmin, condoGestor] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenantCondo.id, name: "Luisa Freitas (Admin)", email: "luisa@administracondo.pt", passwordHash: pwHash, role: "TENANT_ADMIN", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
    prisma.user.create({ data: { tenantId: tenantCondo.id, name: "Paulo Jardim", email: "paulo@administracondo.pt", passwordHash: pwHash, role: "MANAGER", status: "ACTIVE", active: true, authProvider: "EMAIL" } }),
  ]);
  const condoApp = await prisma.applicationInstance.create({ data: { moduleId: modCondominios.id, tenantId: tenantCondo.id, status: "ACTIVE", config: { defaultPermille: 1000, currency: "EUR", region: "Madeira" }, createdBy: condoAdmin.id } });
  await prisma.applicationAssignment.createMany({ data: [
    { userId: condoAdmin.id, applicationId: condoApp.id, roleInApp: "ADMIN", status: "ACTIVE" },
    { userId: condoGestor.id, applicationId: condoApp.id, roleInApp: "MANAGER", status: "ACTIVE" },
  ]});
  const building = await prisma.building.create({ data: { tenantId: tenantCondo.id, name: "Edificio Solar do Atlantico", address: "Rua das Palmeiras, 12", municipality: "Funchal", taxNumber: "500123456", totalPermille: 1000 } });
  const owner = await prisma.owner.create({ data: { name: "Antonio Sousa", email: "antonio@example.pt", phone: "+351 920 000 001" } });
  await prisma.unit.createMany({ data: [
    { buildingId: building.id, identifier: "Fracao A (RC Dto)", permille: 120, ownerId: owner.id },
    { buildingId: building.id, identifier: "Fracao B (RC Esq)", permille: 100 },
    { buildingId: building.id, identifier: "Fracao C (1 Dto)", permille: 130, ownerId: owner.id },
  ]});
  console.log("Administra Condo criada: 2 users, Condominios ACTIVE, 1 edificio, 3 fracoes.\n");

  // Tenant 3: StartUp em TRIAL
  console.log("A criar Tenant 3: StartUp Inovacao...");
  const tenantTrial = await prisma.tenant.create({ data: { name: "StartUp Inovacao, Unip.", slug: "startup-inovacao", email: "hello@startupino.pt", city: "Porto", country: "Portugal", status: "TRIAL" } });
  const trialAdmin = await prisma.user.create({ data: { tenantId: tenantTrial.id, name: "Beatriz Santos", email: "bea@startupino.pt", passwordHash: pwHash, role: "TENANT_OWNER", status: "ACTIVE", active: true, authProvider: "EMAIL" } });
  const trialCrmApp = await prisma.applicationInstance.create({ data: { moduleId: modCrm.id, tenantId: tenantTrial.id, status: "TRIAL", config: { currency: "EUR" }, createdBy: trialAdmin.id } });
  await prisma.applicationAssignment.create({ data: { userId: trialAdmin.id, applicationId: trialCrmApp.id, roleInApp: "ADMIN", status: "ACTIVE" } });
  console.log("StartUp Inovacao criada: 1 user, CRM TRIAL.\n");

  // Tenant 0: HelderLabs Platform System (SUPER ADMIN TENANT — ALL MODULES ACTIVE ALWAYS)
  console.log("A criar Tenant System: HelderLabs Platform System...");
  const tenantPlatform = await prisma.tenant.create({
    data: {
      name: "HelderLabs Platform System",
      slug: "helderlabs-platform",
      email: "helderguiomar@gmail.com",
      phone: "+351 910 000 000",
      address: "HelderLabs HQ",
      city: "Lisboa",
      country: "Portugal",
      status: "ACTIVE"
    }
  });

  const superAdminUser = await prisma.user.create({
    data: {
      tenantId: tenantPlatform.id,
      name: "Helder Guiomar (Super Admin)",
      email: "helderguiomar@gmail.com",
      passwordHash: pwHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      active: true,
      authProvider: "EMAIL"
    }
  });

  // Ativar TODOS os 6 módulos para o HelderLabs Platform System
  const allModules = [modCrm, modCondominios, modFinance, modInvoicing, modSales, modTasks];
  for (const m of allModules) {
    const appInst = await prisma.applicationInstance.create({
      data: {
        moduleId: m.id,
        tenantId: tenantPlatform.id,
        status: "ACTIVE",
        config: { unlimited: true, fullAccess: true },
        createdBy: superAdminUser.id
      }
    });
    await prisma.applicationAssignment.create({
      data: {
        userId: superAdminUser.id,
        applicationId: appInst.id,
        roleInApp: "ADMIN",
        status: "ACTIVE"
      }
    });
  }

  // Criar leads de teste para HelderLabs Platform System
  await prisma.lead.createMany({
    data: [
      { tenantId: tenantPlatform.id, company: "Cliente Diagnostico Web", name: "Dr. Joao Silva", email: "joao.silva@empresa.pt", source: "landing_diagnostico_Advocacia", status: "NEW" },
      { tenantId: tenantPlatform.id, company: "Empresa Logistica Lda", name: "Manuel Santos", email: "manuel@logistica.pt", source: "landing_diagnostico_Distribuição", status: "CONTACTED" },
    ]
  });

  await prisma.auditLog.create({
    data: {
      actorId: superAdminUser.id,
      actorEmail: superAdminUser.email,
      actorType: "USER",
      tenantId: tenantPlatform.id,
      action: "SEED_PLATFORM",
      resource: "Platform",
      result: "SUCCESS",
      timestamp: new Date()
    }
  });
  console.log("HelderLabs Platform System criado com 6 modulos ACTIVE.\n");

  console.log("===========================================");
  console.log("SEED CONCLUIDO:");
  console.log("  4 tenants (incluindo HelderLabs Platform System com 6 modulos ACTIVE)");
  console.log("===========================================");
  console.log("SUPER ADMIN: helderguiomar@gmail.com (password: admin1234)");
  console.log("===========================================\n");
}

main()
  .catch((e) => { console.error("Erro no seed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });