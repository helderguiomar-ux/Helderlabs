import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const CANONICAL_MODULES = [
  { key: 'crm', name: 'CRM & Gestão 360º', description: 'Gestão integrada de clientes, fornecedores, parceiros e contratos.', color: '#2563eb', icon: 'users' },
  { key: 'finance', name: 'Gestão Financeira', description: 'Cockpit financeiro, tesouraria, projeções a 90 dias e controlo orçamental.', color: '#059669', icon: 'dollar-sign' },
  { key: 'hccall', name: 'HCCALL · Call Center Telecom & Energia', description: 'Registo de vendas, tracking de comissões, motor offline PWA e histórico de alterações.', color: '#d97706', icon: 'phone-call' },
  { key: 'sellmais', name: 'SellMais · Inventário & Força de Vendas', description: 'Gestão comercial, inventário de peças e artigos com margens e ficha técnica.', color: '#7c3aed', icon: 'shopping-bag' },
  { key: 'condominios', name: 'Gestão de Condomínios', description: 'Administração de fracções, condomínios, balancetes e rateios.', color: '#0891b2', icon: 'building' }
];

async function ensurePlatformEntitlements() {
  console.log('------------------------------------------------------------');
  console.log('HELDERLABS ERP — ASSEGURAR ACESSO TOTAL DA PLATAFORMA');
  console.log('------------------------------------------------------------');

  const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
  const platformSlug = process.env.PLATFORM_TENANT_SLUG || 'helderlabs-platform';

  // 1. Garantir Tenant da Plataforma
  let tenant = await prisma.tenant.findUnique({ where: { slug: platformSlug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'HelderLabs Platform System',
        slug: platformSlug,
        email: superAdminEmail,
        phone: '+351 910 000 000',
        city: 'Funchal',
        country: 'Portugal',
        status: 'ACTIVE'
      }
    });
    console.log(`[OK] Tenant da Plataforma criado: ${tenant.name} (${tenant.id})`);
  } else {
    if (tenant.status !== 'ACTIVE') {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE' }
      });
      console.log(`[OK] Tenant da Plataforma reativado: ${tenant.name}`);
    } else {
      console.log(`[OK] Tenant da Plataforma ativo: ${tenant.name} (${tenant.id})`);
    }
  }

  // 2. Garantir Branding
  await prisma.tenantBranding.upsert({
    where: { tenantId: tenant.id },
    update: {
      displayName: 'HelderLabs Platform',
      primaryColor: '#0d419f',
      accentColor: '#1f6feb',
      theme: 'system'
    },
    create: {
      tenantId: tenant.id,
      displayName: 'HelderLabs Platform',
      legalName: 'HelderLabs Platform',
      primaryColor: '#0d419f',
      accentColor: '#1f6feb',
      theme: 'system',
      currency: 'EUR',
      country: 'PT'
    }
  });

  // 3. Garantir Utilizador Super Admin
  const defaultPassword = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD || 'admin1234';
  const pwHash = await bcrypt.hash(defaultPassword, 10);

  let user = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Helder Guiomar',
        email: superAdminEmail,
        passwordHash: pwHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        active: true,
        authProvider: 'EMAIL'
      }
    });
    console.log(`[OK] Utilizador Super Admin criado: ${user.email} (${user.id})`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        tenantId: tenant.id,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        active: true
      }
    });
    console.log(`[OK] Utilizador Super Admin sincronizado: ${user.email}`);
  }

  // 4. Garantir Módulos, ApplicationInstances e Atribuições
  for (const modData of CANONICAL_MODULES) {
    const mod = await prisma.module.upsert({
      where: { key: modData.key },
      update: {
        name: modData.name,
        description: modData.description,
        color: modData.color,
        icon: modData.icon,
        isActive: true
      },
      create: {
        key: modData.key,
        name: modData.name,
        description: modData.description,
        color: modData.color,
        icon: modData.icon,
        isActive: true
      }
    });

    const appInst = await prisma.applicationInstance.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: {
        status: 'ACTIVE',
        plan: 'enterprise',
        priceCents: 0,
        billingPeriod: 'MONTHLY',
        validUntil: null, // Acesso perpétuo
        graceDays: 30,
        config: { unlimited: true, fullAccess: true, platformOwner: true }
      },
      create: {
        tenantId: tenant.id,
        moduleId: mod.id,
        status: 'ACTIVE',
        plan: 'enterprise',
        priceCents: 0,
        billingPeriod: 'MONTHLY',
        validUntil: null,
        graceDays: 30,
        config: { unlimited: true, fullAccess: true, platformOwner: true },
        createdBy: user.id
      }
    });

    await prisma.applicationAssignment.upsert({
      where: { userId_applicationId: { userId: user.id, applicationId: appInst.id } },
      update: {
        roleInApp: 'ADMIN',
        status: 'ACTIVE'
      },
      create: {
        userId: user.id,
        applicationId: appInst.id,
        roleInApp: 'ADMIN',
        status: 'ACTIVE'
      }
    });

    console.log(`[OK] Módulo '${modData.key}' ativo e atribuído ao Super Admin.`);
  }

  // 5. Incrementar Entitlements Version para forçar invalidação
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { entitlementsVersion: { increment: 1 } }
  });

  console.log('------------------------------------------------------------');
  console.log('TODAS AS INSTÂNCIAS E LICENÇAS GARANTIDAS COM SUCESSO.');
  console.log('------------------------------------------------------------');
}

ensurePlatformEntitlements()
  .catch(err => {
    console.error('[ERRO NO SCRIPT]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
