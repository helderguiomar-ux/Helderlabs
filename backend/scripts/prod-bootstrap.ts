import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function bootstrap() {
  console.log('[PROD BOOTSTRAP] A verificar e sincronizar dados essenciais de produção...');

  // 1. Módulos da Plataforma (Idempotente com upsert)
  const modulesToUpsert = [
    { key: 'crm', name: 'CRM', description: 'Gestão de Leads, Oportunidades e Clientes', icon: 'users', color: '#0d419f', category: 'Comercial', sortOrder: 10, isActive: true },
    { key: 'condominios', name: 'Condomínios', description: 'Gestão de edifícios, frações e assembleias', icon: 'building', color: '#2563eb', category: 'Operações', sortOrder: 20, isActive: true },
    { key: 'finance', name: 'Gestão Financeira', description: 'Cockpit financeiro, tesouraria, despesas e projeções', icon: 'wallet', color: '#059669', category: 'Financeiro', sortOrder: 30, isActive: true },
    { key: 'hccall', name: 'HCCALL Telecom', description: 'Ferramenta operacional para operadores e lojas de telecomunicações', icon: 'headset', color: '#0d419f', category: 'Comercial', sortOrder: 70, isActive: true },
    { key: 'sellmais', name: '2SELLMAIS', description: 'Gestão de inventário e comércio em segunda mão, velharias e antiguidades', icon: 'shopping-bag', color: '#b45309', category: 'Comercial', sortOrder: 80, isActive: true }
  ];

  const dbModules: any[] = [];
  for (const m of modulesToUpsert) {
    const mod = await prisma.module.upsert({
      where: { key: m.key },
      update: {
        name: m.name,
        description: m.description,
        icon: m.icon,
        color: m.color,
        category: m.category,
        sortOrder: m.sortOrder,
        isActive: m.isActive
      },
      create: m
    });
    dbModules.push(mod);
  }
  console.log(`[PROD BOOTSTRAP] ${dbModules.length} módulos sincronizados.`);

  // 2. Tenant Principal
  const tenantEmail = 'helderguiomar@gmail.com';
  let tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { slug: 'helderlabs-platform' },
        { email: tenantEmail }
      ]
    }
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'HelderLabs Platform System',
        slug: 'helderlabs-platform',
        email: tenantEmail,
        phone: '+351 910 000 000',
        address: 'HelderLabs HQ',
        city: 'Lisboa',
        country: 'Portugal',
        status: 'ACTIVE'
      }
    });
    console.log('[PROD BOOTSTRAP] Tenant criado:', tenant.id);
  }

  // 3. Tenant Branding
  await prisma.tenantBranding.upsert({
    where: { tenantId: tenant.id },
    update: {
      displayName: 'HelderLabs Platform',
      primaryColor: '#0d419f',
      accentColor: '#1f6feb',
      theme: 'dark'
    },
    create: {
      tenantId: tenant.id,
      displayName: 'HelderLabs Platform',
      legalName: 'HelderLabs Systems',
      primaryColor: '#0d419f',
      accentColor: '#1f6feb',
      theme: 'dark',
      currency: 'EUR',
      country: 'PT'
    }
  });

  // 4. Utilizador Super Admin
  const pwHash = await bcrypt.hash('admin1234', 10);
  let user = await prisma.user.findUnique({
    where: { email: tenantEmail }
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Helder Guiomar',
        email: tenantEmail,
        passwordHash: pwHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        active: true,
        authProvider: 'EMAIL'
      }
    });
    console.log('[PROD BOOTSTRAP] Super Admin criado:', user.id);
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        tenantId: tenant.id,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        active: true
      }
    });
  }

  // 5. Atribuições de Aplicação
  for (const mod of dbModules) {
    if (!mod.isActive) continue;

    let appInst = await prisma.applicationInstance.findFirst({
      where: { tenantId: tenant.id, moduleId: mod.id }
    });

    if (!appInst) {
      appInst = await prisma.applicationInstance.create({
        data: {
          tenantId: tenant.id,
          moduleId: mod.id,
          status: 'ACTIVE',
          config: { unlimited: true },
          createdBy: user.id
        }
      });
    } else if (appInst.status !== 'ACTIVE') {
      await prisma.applicationInstance.update({
        where: { id: appInst.id },
        data: { status: 'ACTIVE' }
      });
    }

    const assignment = await prisma.applicationAssignment.findFirst({
      where: { userId: user.id, applicationId: appInst.id }
    });

    if (!assignment) {
      await prisma.applicationAssignment.create({
        data: {
          userId: user.id,
          applicationId: appInst.id,
          roleInApp: 'ADMIN',
          status: 'ACTIVE'
        }
      });
    }
  }

  console.log('[PROD BOOTSTRAP] Concluído com sucesso!');
}

bootstrap()
  .catch((e) => {
    console.error('[PROD BOOTSTRAP ERROR]', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
