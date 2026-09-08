import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { z } from 'zod';
import { signAuthToken } from '../../../plugins/authenticate';
import { EntitlementService } from '../services/EntitlementService';
import { AuditService } from '../services/AuditService';
import { seedFinancas } from '../../financas/services/seedFinancas';

// ---------------------------------------------------------------------------
// Schemas de validação
// ---------------------------------------------------------------------------

const CreateApplicationSchema = z.object({
  moduleId: z.string().min(1, 'moduleId é obrigatório'),
  tenantId: z.string().optional(),               // Super Admin pode especificar; outros usam o próprio
  status: z.enum(['DISABLED', 'TRIAL', 'ACTIVE', 'ARCHIVED']).default('TRIAL'),
  plan: z.string().optional().default('pro'),
  priceCents: z.number().int().optional().default(0),
  billingPeriod: z.enum(['MONTHLY', 'ANNUAL', 'ONE_TIME']).optional().default('MONTHLY'),
  currency: z.string().optional().default('EUR'),
  discountPercent: z.number().min(0).max(100).optional().default(0),
  billingNotes: z.string().optional().nullable(),
  config: z.record(z.unknown()).optional().default({})
});

const UpdateApplicationSchema = z.object({
  status: z.enum(['DISABLED', 'TRIAL', 'ACTIVE', 'ARCHIVED']).optional(),
  plan: z.string().optional(),
  priceCents: z.number().int().optional(),
  billingPeriod: z.enum(['MONTHLY', 'ANNUAL', 'ONE_TIME']).optional(),
  currency: z.string().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  billingNotes: z.string().optional().nullable(),
  config: z.record(z.unknown()).optional()
});

const AssignUserSchema = z.object({
  userId: z.string().min(1, 'userId é obrigatório'),
  roleInApp: z.string().default('USER'),
  status: z.enum(['PENDING', 'ACTIVE', 'DECLINED', 'REMOVED']).default('ACTIVE')
});

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ApplicationController {

  /**
   * GET /api/platform/applications
   * Lista os aplicativos (instâncias de módulos).
   *   - SUPER_ADMIN / PLATFORM_ADMIN → vê todos (com filtro opcional ?tenantId=...)
   *   - Outros → só os do próprio tenant
   */
  static async list(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const query = req.query as { tenantId?: string };

    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';

    const whereClause = isSuperAdmin && query.tenantId
      ? { tenantId: query.tenantId }
      : isSuperAdmin
        ? {}
        : { tenantId: user.tenantId };

    const apps = await prisma.applicationInstance.findMany({
      where: whereClause,
      include: {
        module: true,
        tenant: { select: { id: true, name: true, slug: true } },
        assignments: {
          include: {
            user: { select: { id: true, email: true, name: true, role: true } }
          }
        }
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    });

    return reply.send({
      success: true,
      count: apps.length,
      applications: apps.map(app => ({
        id:           app.id,
        moduleId:     app.moduleId,
        moduleName:   app.module.name,
        moduleActive: app.module.isActive,
        tenantId:     app.tenantId,
        tenantName:   app.tenant.name,
        status:       app.status,
        config:       app.config,
        usersCount:   app.assignments.length,
        createdAt:    app.createdAt,
        assignments:  app.assignments.map(a => ({
          userId:    a.user.id,
          userName:  a.user.name || a.user.email,
          userEmail: a.user.email,
          roleInApp: a.roleInApp,
          status:    a.status
        }))
      }))
    });
  }

  /**
   * POST /api/platform/applications
   * Activa um módulo para um tenant (cria ApplicationInstance).
   */
  static async create(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const body = CreateApplicationSchema.parse(req.body);

    // Determinar tenantId: Super Admin pode especificar qualquer tenant;
    // outros usam sempre o próprio.
    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';
    const tenantId = (isSuperAdmin && body.tenantId) ? body.tenantId : user.tenantId;

    // Verificar que o módulo existe e está activo globalmente
    const module = await prisma.module.findUnique({ where: { id: body.moduleId } });
    if (!module) {
      return reply.status(404).send({ error: 'MODULE_NOT_FOUND', message: `Módulo não encontrado: ${body.moduleId}` });
    }
    if (!module.isActive && !isSuperAdmin) {
      return reply.status(403).send({ error: 'MODULE_INACTIVE', message: 'Este módulo não está disponível.' });
    }

    // Verificar que o tenant existe
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return reply.status(404).send({ error: 'TENANT_NOT_FOUND', message: 'Empresa não encontrada.' });
    }

    // Verificar se já existe instância deste módulo para este tenant
    const existing = await prisma.applicationInstance.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: body.moduleId } }
    });
    if (existing) {
      return reply.status(409).send({
        error: 'APPLICATION_ALREADY_EXISTS',
        message: `O módulo "${module.name}" já está configurado para esta empresa (status: ${existing.status}).`,
        existingId: existing.id
      });
    }

    const app = await prisma.applicationInstance.create({
      data: {
        moduleId:  body.moduleId,
        tenantId,
        status:    body.status,
        config:    (body.config as any) ?? {},
        createdBy: user.sub || user.id
      },
      include: { module: true, tenant: { select: { id: true, name: true } } }
    });

    return reply.status(201).send({
      success: true,
      application: {
        id:         app.id,
        moduleName: (app as any).module.name,
        tenantName: (app as any).tenant.name,
        status:     app.status,
        config:     app.config
      }
    });
  }

  /**
   * PATCH /api/platform/applications/:applicationId
   * Actualiza status e/ou config de um aplicativo.
   */
  static async update(req: FastifyRequest, reply: FastifyReply) {
    const { applicationId } = req.params as { applicationId: string };
    const user = req.user as any;
    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';
    const body = UpdateApplicationSchema.parse(req.body);

    const app = await prisma.applicationInstance.findUnique({ where: { id: applicationId } });
    if (!app) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Aplicativo não encontrado.' });
    }

    if (!isSuperAdmin && app.tenantId !== user.tenantId) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Não tem permissão para alterar este aplicativo.' });
    }

    const updated = await prisma.applicationInstance.update({
      where: { id: applicationId },
      data: {
        ...(body.status !== undefined && { status: body.status }),
        ...(body.config !== undefined && { config: body.config as any })
      },
      include: { module: true }
    });

    return reply.send({
      success: true,
      application: { id: updated.id, moduleName: (updated as any).module.name, status: updated.status, config: updated.config }
    });
  }

  /**
   * DELETE /api/platform/applications/:applicationId
   * Remove (arquiva) um aplicativo e todas as suas atribuições.
   */
  static async remove(req: FastifyRequest, reply: FastifyReply) {
    const { applicationId } = req.params as { applicationId: string };
    const user = req.user as any;
    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';

    const app = await prisma.applicationInstance.findUnique({ where: { id: applicationId } });
    if (!app) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Aplicativo não encontrado.' });
    }

    if (!isSuperAdmin && app.tenantId !== user.tenantId) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Não tem permissão para remover este aplicativo.' });
    }

    // Soft-delete: mudar para ARCHIVED (preserva histórico)
    await prisma.applicationInstance.update({
      where: { id: applicationId },
      data: { status: 'ARCHIVED' }
    });

    return reply.send({ success: true, message: 'Aplicativo arquivado.' });
  }

  /**
   * POST /api/platform/applications/:applicationId/assign
   * Atribui (ou actualiza) um utilizador a um aplicativo.
   */
  static async assignUser(req: FastifyRequest, reply: FastifyReply) {
    const { applicationId } = req.params as { applicationId: string };
    const user = req.user as any;
    const body = AssignUserSchema.parse(req.body);

    const app = await prisma.applicationInstance.findUnique({ where: { id: applicationId } });
    if (!app) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Aplicativo não encontrado.' });
    }

    // Verificar que o utilizador pertence ao mesmo tenant que o aplicativo
    const targetUser = await prisma.user.findFirst({
      where: { id: body.userId, tenantId: app.tenantId }
    });
    if (!targetUser) {
      return reply.status(404).send({
        error: 'USER_NOT_FOUND',
        message: 'Utilizador não encontrado nesta empresa.'
      });
    }

    const assignment = await prisma.applicationAssignment.upsert({
      where: { userId_applicationId: { userId: body.userId, applicationId } },
      create: {
        userId:        body.userId,
        applicationId,
        roleInApp:     body.roleInApp,
        status:        body.status
      },
      update: {
        roleInApp: body.roleInApp,
        status:    body.status
      },
      include: {
        user: { select: { id: true, email: true, name: true } }
      }
    });

    return reply.send({
      success: true,
      assignment: {
        userId:    assignment.user.id,
        userName:  assignment.user.name || assignment.user.email,
        roleInApp: assignment.roleInApp,
        status:    assignment.status
      }
    });
  }

  /**
   * DELETE /api/platform/applications/:applicationId/assign/:userId
   * Remove um utilizador de um aplicativo.
   */
  static async removeUser(req: FastifyRequest, reply: FastifyReply) {
    const { applicationId, userId } = req.params as { applicationId: string; userId: string };

    await prisma.applicationAssignment.updateMany({
      where: { userId, applicationId },
      data: { status: 'REMOVED' }
    });

    return reply.send({ success: true });
  }

  /**
   * GET /api/platform/modules
   * Lista todos os módulos disponíveis globalmente (para o picker de activação).
   */
  static async listModules(req: FastifyRequest, reply: FastifyReply) {
    const modules = await prisma.module.findMany({
      orderBy: { name: 'asc' }
    });

    return reply.send({
      success: true,
      modules: modules.map(m => ({
        id:          m.id,
        name:        m.name,
        description: m.description,
        isActive:    m.isActive
      }))
    });
  }

  /**
   * POST /api/platform/impersonate
   * Inicia uma sessão de suporte auditada (Impersonation)
   */
  static async startImpersonation(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas o Super Admin pode iniciar sessão de suporte.' });
    }

    const body = z.object({
      targetTenantId: z.string().min(1),
      targetUserId: z.string().optional(),
      reason: z.string().min(5, 'Motivo de suporte obrigatório (mínimo 5 caracteres)'),
      writeEnabled: z.boolean().default(false)
    }).parse(req.body);

    const targetTenant = await prisma.tenant.findUnique({ where: { id: body.targetTenantId } });
    if (!targetTenant) {
      return reply.status(404).send({ error: 'TENANT_NOT_FOUND', message: 'Tenant alvo não encontrado.' });
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
    const session = await prisma.impersonationSession.create({
      data: {
        actorUserId: user.sub,
        actorEmail: user.email,
        targetTenantId: body.targetTenantId,
        targetUserId: body.targetUserId,
        reason: body.reason,
        writeEnabled: body.writeEnabled,
        expiresAt,
        ipAddress: req.ip
      }
    });

    const token = signAuthToken({
      sub: user.sub,
      email: user.email,
      role: user.role,
      tenantId: body.targetTenantId,
      aud: 'tenant',
      impersonationId: session.id,
      actingTenantId: body.targetTenantId,
      actingUserId: body.targetUserId || user.sub,
      onBehalfOfId: body.targetUserId,
      writeEnabled: body.writeEnabled
    }, '30m');

    return reply.send({
      success: true,
      token,
      session: {
        id: session.id,
        targetTenantName: targetTenant.name,
        writeEnabled: session.writeEnabled,
        expiresAt: session.expiresAt
      }
    });
  }

  /**
   * POST /api/platform/impersonate/end
   * Encerra uma sessão de suporte
   */
  static async endImpersonation(req: FastifyRequest, reply: FastifyReply) {
    const body = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    await prisma.impersonationSession.update({
      where: { id: body.sessionId },
      data: { endedAt: new Date() }
    });
    return reply.send({ success: true, message: 'Sessão de suporte encerrada.' });
  }

  /**
   * POST /api/platform/account-requests/:id/approve
   * Aprovação de conta em 1 clique numa única transação atómica
   */
  static async approveAccountRequest(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const { id } = req.params as { id: string };
    const body = z.object({
      tenantId: z.string().optional(),
      role: z.string().default('TENANT_ADMIN'),
      modules: z.array(z.string()).optional()
    }).parse(req.body || {});

    const accountReq = await prisma.accountRequest.findUnique({ where: { id } });
    if (!accountReq) {
      return reply.status(404).send({ error: 'REQUEST_NOT_FOUND', message: 'Pedido de conta não encontrado.' });
    }

    const companyName = accountReq.companyName || accountReq.name || accountReq.contactName || accountReq.email.split('@')[0];

    const result = await prisma.$transaction(async (tx) => {
      let targetTenantId = body.tenantId;

      // Se não for fornecido tenantId, criar novo Tenant
      if (!targetTenantId) {
        let baseSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (!baseSlug) baseSlug = 'tenant';
        
        let slug = baseSlug;
        let count = 0;
        while (await tx.tenant.findUnique({ where: { slug } })) {
          count++;
          slug = `${baseSlug}-${count}`;
        }

        const newTenant = await tx.tenant.create({
          data: {
            name: companyName,
            slug,
            email: accountReq.email,
            phone: accountReq.phone,
            status: 'ACTIVE'
          }
        });

        await tx.tenantBranding.create({
          data: {
            tenantId: newTenant.id,
            displayName: companyName,
            legalName: companyName,
            primaryColor: '#0d419f',
            accentColor: '#1f6feb',
            theme: 'system',
            currency: 'EUR',
            country: 'PT',
            timezone: 'Atlantic/Madeira'
          }
        });

        targetTenantId = newTenant.id;
      }

      // Criar ou atualizar utilizador
      let targetUser = await tx.user.findUnique({ where: { email: accountReq.email } });
      const contactName = accountReq.contactName || accountReq.name || accountReq.email.split('@')[0];

      if (!targetUser) {
        targetUser = await tx.user.create({
          data: {
            tenantId: targetTenantId,
            name: contactName,
            email: accountReq.email,
            role: body.role as any,
            status: 'ACTIVE',
            active: true,
            authProvider: 'EMAIL'
          }
        });
      } else {
        targetUser = await tx.user.update({
          where: { id: targetUser.id },
          data: {
            tenantId: targetTenantId,
            role: body.role as any,
            status: 'ACTIVE',
            active: true
          }
        });
      }

      // Módulos a ativar
      let modulesToActivate = body.modules;
      if (!modulesToActivate || modulesToActivate.length === 0) {
        const intended = accountReq.intendedModule?.toLowerCase();
        if (intended && intended !== 'all') {
          modulesToActivate = [intended];
        } else {
          modulesToActivate = ['crm', 'condominios', 'financas'];
        }
      }

      for (const modKey of modulesToActivate) {
        const normalizedKey = modKey === 'financas' ? 'finance' : modKey;
        let mod = await tx.module.findFirst({ where: { key: normalizedKey } });
        if (!mod) {
          mod = await tx.module.create({
            data: {
              key: normalizedKey,
              name: normalizedKey.toUpperCase(),
              isActive: true
            }
          });
        }

        const appInstance = await tx.applicationInstance.upsert({
          where: { tenantId_moduleId: { tenantId: targetTenantId, moduleId: mod.id } },
          create: {
            tenantId: targetTenantId,
            moduleId: mod.id,
            status: 'ACTIVE',
            createdBy: user.sub
          },
          update: { status: 'ACTIVE' }
        });

        await tx.applicationAssignment.upsert({
          where: { userId_applicationId: { userId: targetUser.id, applicationId: appInstance.id } },
          create: {
            userId: targetUser.id,
            applicationId: appInstance.id,
            roleInApp: 'ADMIN',
            status: 'ACTIVE'
          },
          update: { status: 'ACTIVE', roleInApp: 'ADMIN' }
        });

        // Executar seed do módulo
        if (normalizedKey === 'finance' || modKey === 'financas') {
          await seedFinancas(targetTenantId, tx);
        }
      }

      // Atualizar pedido de conta
      await tx.accountRequest.update({
        where: { id: accountReq.id },
        data: {
          status: 'APPROVED',
          approvedBy: user.sub,
          approvedAt: new Date()
        }
      });

      // Incrementar entitlementsVersion do Tenant
      await tx.tenant.update({
        where: { id: targetTenantId },
        data: { entitlementsVersion: { increment: 1 } }
      });

      return { tenantId: targetTenantId, user: targetUser };
    });

    // Invalidação de cache fora da transação
    EntitlementService.invalidateCache(result.tenantId);

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      tenantId: result.tenantId,
      action: 'account_request.approved',
      resource: 'AccountRequest',
      resourceId: id,
      newValue: { tenantId: result.tenantId, userId: result.user.id },
      result: 'SUCCESS'
    });

    return reply.send({
      success: true,
      message: 'Pedido de conta aprovado com sucesso.',
      tenantId: result.tenantId,
      user: result.user
    });
  }

  /**
   * POST /api/platform/account-requests/:id/reject
   * Rejeição de pedido de conta
   */
  static async rejectAccountRequest(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const { id } = req.params as { id: string };
    const body = z.object({
      reason: z.string().min(3, 'Motivo de rejeição é obrigatório (mínimo 3 caracteres)')
    }).parse(req.body);

    const accountReq = await prisma.accountRequest.findUnique({ where: { id } });
    if (!accountReq) {
      return reply.status(404).send({ error: 'REQUEST_NOT_FOUND', message: 'Pedido de conta não encontrado.' });
    }

    const updated = await prisma.accountRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedBy: user.sub,
        rejectedAt: new Date(),
        rejectionReason: body.reason
      }
    });

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      action: 'account_request.rejected',
      resource: 'AccountRequest',
      resourceId: id,
      newValue: { reason: body.reason },
      result: 'SUCCESS'
    });

    return reply.send({ success: true, message: 'Pedido de conta rejeitado.', accountRequest: updated });
  }

  /**
   * GET /api/platform/licensing/summary
   * Retorna resumo de receitas recorrentes (MRR/ARR), licenças ativas, e distribuição de planos.
   */
  static async getLicensingSummary(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const apps = await prisma.applicationInstance.findMany({
      where: { deletedAt: null },
      include: {
        module: true,
        tenant: { select: { id: true, name: true, slug: true } }
      }
    });

    let totalMrrCents = 0;
    let activeLicenses = 0;
    let trialLicenses = 0;
    let suspendedLicenses = 0;
    const modulesMrr: Record<string, { moduleName: string; count: number; mrrCents: number }> = {};

    for (const app of apps) {
      if (app.status === 'ACTIVE') {
        activeLicenses++;
        const rawPrice = app.priceCents || 0;
        const discount = app.discountPercent || 0;
        const netPrice = Math.round(rawPrice * (1 - discount / 100));

        let appMrrCents = 0;
        if (app.billingPeriod === 'MONTHLY') {
          appMrrCents = netPrice;
        } else if (app.billingPeriod === 'ANNUAL') {
          appMrrCents = Math.round(netPrice / 12);
        }

        totalMrrCents += appMrrCents;

        const modId = app.moduleId;
        if (!modulesMrr[modId]) {
          modulesMrr[modId] = {
            moduleName: app.module.name,
            count: 0,
            mrrCents: 0
          };
        }
        modulesMrr[modId].count++;
        modulesMrr[modId].mrrCents += appMrrCents;
      } else if (app.status === 'TRIAL') {
        trialLicenses++;
      } else if (app.status === 'DISABLED' || app.status === 'ARCHIVED') {
        suspendedLicenses++;
      }
    }

    const totalArrCents = totalMrrCents * 12;

    return reply.send({
      success: true,
      summary: {
        totalMrrCents,
        totalArrCents,
        activeLicenses,
        trialLicenses,
        suspendedLicenses,
        totalLicenses: apps.length,
        modulesDistribution: Object.values(modulesMrr)
      }
    });
  }
}

