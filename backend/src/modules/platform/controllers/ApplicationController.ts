import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { signAuthToken } from '../../../plugins/authenticate';
import { EntitlementService } from '../services/EntitlementService';
import { AuditService } from '../services/AuditService';
import { EmailService } from '../services/EmailService';
import { seedFinancas } from '../../financas/services/seedFinancas';
import { SYSTEM_MODULES, resolveCanonicalModuleKey, isModuleRegistered, getAllRegisteredModules } from '../../../config/modules';

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
        moduleKey:    app.module.key,
        moduleName:   app.module.name,
        moduleIcon:   app.module.icon,
        moduleColor:  app.module.color,
        moduleCategory: app.module.category,
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

    // REGRA FUNDAMENTAL: Um utilizador não pode receber uma licença enquanto o email não estiver validado.
    if (!targetUser.emailVerifiedAt) {
      return reply.status(400).send({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Este utilizador ainda não validou o endereço de email. Envie novamente o email de validação antes de atribuir uma licença.',
        userId: targetUser.id,
        userEmail: targetUser.email
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
      modules: z.array(z.string()).optional(),
      forceVerify: z.boolean().optional()
    }).parse(req.body || {});

    const accountReq = await prisma.accountRequest.findUnique({ where: { id } });
    if (!accountReq) {
      return reply.status(404).send({ error: 'REQUEST_NOT_FOUND', message: 'Pedido de conta não encontrado.' });
    }

    if (accountReq.status === 'APPROVED') {
      return reply.status(400).send({
        error: 'ACCOUNT_ALREADY_APPROVED',
        message: 'Este pedido de conta já foi aprovado anteriormente.'
      });
    }

    if (!accountReq.emailVerifiedAt) {
      if (body.forceVerify) {
        await prisma.accountRequest.update({
          where: { id },
          data: { emailVerifiedAt: new Date() }
        });
      } else {
        return reply.status(400).send({
          error: 'EMAIL_NOT_VERIFIED',
          message: 'O email deste pedido ainda não foi verificado pelo utilizador. Apenas pedidos com email validado podem ser aprovados.'
        });
      }
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
            passwordHash: accountReq.passwordHash || null,
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
            active: true,
            ...(accountReq.passwordHash && !targetUser.passwordHash && { passwordHash: accountReq.passwordHash })
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

    // Enviar email de notificação ao utilizador
    const contactName = accountReq.contactName || accountReq.name || accountReq.email.split('@')[0];
    await EmailService.sendAccountApprovedEmail(accountReq.email, contactName, undefined, {
      tenantId: result.tenantId
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
   * POST /api/platform/account-requests/:id/resend-code
   * Super Admin reenvia código de verificação para um pedido de adesão (válido por 24h)
   */
  static async resendAccountRequestCode(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const { id } = req.params as { id: string };
    const accountReq = await prisma.accountRequest.findUnique({ where: { id } });
    if (!accountReq) {
      return reply.status(404).send({ error: 'REQUEST_NOT_FOUND', message: 'Pedido de conta não encontrado.' });
    }

    if (accountReq.status === 'APPROVED') {
      return reply.status(400).send({ error: 'ACCOUNT_ALREADY_APPROVED', message: 'Esta conta já foi aprovada.' });
    }

    const contactName = accountReq.contactName || accountReq.name || accountReq.email.split('@')[0];
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        otpHash,
        otpExpiresAt,
        otpAttempts: 0,
        emailDeliveryStatus: 'PENDING',
        emailLastAttemptAt: new Date()
      }
    });

    const emailResult = await EmailService.sendVerificationEmail(accountReq.email, contactName, otpCode, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined
    });

    await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        emailDeliveryStatus: emailResult.ok ? 'SENT' : 'FAILED',
        emailDeliveryError: emailResult.ok ? null : `${emailResult.code ?? 'UNKNOWN'}: ${emailResult.message ?? ''}`.slice(0, 500)
      }
    });

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      action: 'account_request.resend_code',
      resource: 'AccountRequest',
      resourceId: id,
      newValue: { email: accountReq.email, delivered: emailResult.ok },
      result: emailResult.ok ? 'SUCCESS' : 'FAILURE'
    });

    return reply.send({
      success: true,
      emailDelivered: emailResult.ok,
      message: emailResult.ok
        ? 'Código de validação (24h) reenviado com sucesso para ' + accountReq.email
        : 'Código gerado na plataforma (válido por 24h), mas o fornecedor de email devolveu aviso: ' + (emailResult.message || 'Falha no envio')
    });
  }

  /**
   * POST /api/platform/account-requests/:id/force-verify
   * Super Admin valida manualmente o email de um pedido
   */
  static async forceVerifyAccountRequest(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const { id } = req.params as { id: string };
    const accountReq = await prisma.accountRequest.findUnique({ where: { id } });
    if (!accountReq) {
      return reply.status(404).send({ error: 'REQUEST_NOT_FOUND', message: 'Pedido de conta não encontrado.' });
    }

    const updated = await prisma.accountRequest.update({
      where: { id },
      data: {
        status: accountReq.status === 'PENDING_VERIFICATION' ? 'PENDING' : accountReq.status,
        emailVerifiedAt: accountReq.emailVerifiedAt || new Date(),
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0
      }
    });

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      action: 'account_request.force_verified',
      resource: 'AccountRequest',
      resourceId: id,
      newValue: { email: accountReq.email, verifiedManually: true },
      result: 'SUCCESS'
    });

    return reply.send({
      success: true,
      message: 'Email validado manualmente pelo Administrador.',
      accountRequest: updated
    });
  }

  /**
   * GET /api/platform/licensing/dashboard
   * Retorna os indicadores reais de topo e a listagem consolidada de empresas (1 linha por empresa).
   */
  static async getLicensingDashboard(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const totalTenants = await prisma.tenant.count({ where: { deletedAt: null } });

    const activeApplications = await prisma.applicationInstance.findMany({
      where: { deletedAt: null },
      include: {
        module: true,
        tenant: { select: { id: true, name: true, slug: true, status: true } }
      }
    });

    let activeModulesCount = 0;
    let trialCount = 0;
    let renewals30DaysCount = 0;
    let lifetimeLicensesCount = 0;

    for (const app of activeApplications) {
      if (app.status === 'ACTIVE') {
        activeModulesCount++;
        if (!app.validUntil) {
          lifetimeLicensesCount++;
        } else {
          const vUntil = new Date(app.validUntil);
          if (vUntil >= now && vUntil <= thirtyDaysFromNow) {
            renewals30DaysCount++;
          }
        }
      } else if (app.status === 'TRIAL') {
        trialCount++;
        if (app.validUntil) {
          const vUntil = new Date(app.validUntil);
          if (vUntil >= now && vUntil <= thirtyDaysFromNow) {
            renewals30DaysCount++;
          }
        }
      }
    }

    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { users: true } },
        applications: {
          where: { deletedAt: null },
          include: {
            module: true,
            assignments: { select: { id: true, userId: true } }
          }
        },
        users: {
          select: { id: true, name: true, email: true, emailVerifiedAt: true, role: true, active: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const companies = tenants.map(t => {
      const activeApps = t.applications.filter(a => a.status === 'ACTIVE' || a.status === 'TRIAL');
      const modulesList = activeApps.map(a => ({
        key: resolveCanonicalModuleKey(a.module.key),
        name: a.module.name,
        status: a.status,
        isLifetime: a.validUntil === null,
        validUntil: a.validUntil,
        priceCents: a.priceCents,
        billingPeriod: a.billingPeriod,
        usersCount: a.assignments.length
      }));

      let nextRenewal: Date | null = null;
      let hasOnlyLifetime = activeApps.length > 0;

      for (const app of activeApps) {
        if (app.validUntil) {
          hasOnlyLifetime = false;
          const d = new Date(app.validUntil);
          if (!nextRenewal || d < nextRenewal) {
            nextRenewal = d;
          }
        }
      }

      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        email: t.email,
        phone: t.phone,
        status: t.status,
        createdAt: t.createdAt,
        userCount: t._count.users,
        users: t.users.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          isEmailVerified: Boolean(u.emailVerifiedAt)
        })),
        activeModulesCount: activeApps.length,
        modules: modulesList,
        isAllLifetime: hasOnlyLifetime && activeApps.length > 0,
        nextRenewal: nextRenewal ? nextRenewal.toISOString() : null
      };
    });

    return reply.send({
      success: true,
      stats: {
        totalTenants,
        activeModulesCount,
        trialCount,
        renewals30DaysCount,
        lifetimeLicensesCount
      },
      companies
    });
  }

  /**
   * POST /api/platform/users/:userId/resend-verification
   * Envia ou reenvia link seguro de validação de email para um utilizador
   */
  static async resendUserVerificationEmail(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { userId } = req.params as { userId: string };

    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true }
    });

    if (!targetUser) {
      return reply.status(404).send({ error: 'USER_NOT_FOUND', message: 'Utilizador não encontrado.' });
    }

    if (!isSuperAdmin && targetUser.tenantId !== user.tenantId) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para este utilizador.' });
    }

    if (targetUser.emailVerifiedAt) {
      return reply.status(400).send({
        error: 'ALREADY_VERIFIED',
        message: 'O endereço de email deste utilizador já se encontra validado.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await prisma.user.update({
      where: { id: targetUser.id },
      data: {
        emailVerificationToken: token,
        emailVerificationExpiresAt: expiresAt
      }
    });

    const appUrl = process.env.APP_URL || 'https://helderlabs.eu';
    const verificationUrl = `${appUrl}/api/public/verify-user-email?token=${token}`;

    const emailResult = await EmailService.sendUserVerificationLinkEmail(
      targetUser.email,
      targetUser.name || targetUser.email.split('@')[0],
      verificationUrl,
      {
        tenantId: targetUser.tenantId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined
      }
    );

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: isSuperAdmin ? 'SUPER_ADMIN' : 'USER',
      tenantId: targetUser.tenantId,
      action: 'user.verification_link_sent',
      resource: 'User',
      resourceId: targetUser.id,
      newValue: { email: targetUser.email, delivered: emailResult.ok },
      result: emailResult.ok ? 'SUCCESS' : 'FAILURE'
    });

    return reply.send({
      success: true,
      emailDelivered: emailResult.ok,
      message: emailResult.ok
        ? `Email de validação enviado com sucesso para ${targetUser.email}.`
        : `Token gerado, mas o serviço de email devolveu: ${emailResult.message || 'Falha no envio'}`
    });
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

  /**
   * GET /api/platform/tenants/:tenantId/licensing
   * Retorna o estado completo de licenciamento da empresa para todos os módulos do catálogo
   */
  static async getTenantLicensing(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    const { tenantId } = req.params as { tenantId: string };

    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';
    if (!isSuperAdmin && user.tenantId !== tenantId) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Sem permissão para consultar licenciamento deste tenant.' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, emailVerifiedAt: true, active: true }
        },
        applications: {
          where: { deletedAt: null },
          include: {
            module: true,
            assignments: {
              include: { user: { select: { id: true, name: true, email: true, role: true, emailVerifiedAt: true } } }
            }
          }
        }
      }
    });

    if (!tenant) {
      return reply.status(404).send({ error: 'TENANT_NOT_FOUND', message: 'Empresa não encontrada.' });
    }

    const appByModuleKey = new Map<string, any>();
    for (const app of tenant.applications) {
      const canonicalKey = resolveCanonicalModuleKey(app.module.key);
      appByModuleKey.set(canonicalKey, app);
    }

    let totalMonthlyCents = 0;
    const modulesList = getAllRegisteredModules().map(def => {
      const app = appByModuleKey.get(def.key);
      const status = app ? app.status : 'UNLICENSED';
      const rawPrice = app?.priceCents ?? 0;
      const discount = app?.discountPercent ?? 0;
      const netPrice = Math.round(rawPrice * (1 - discount / 100));

      if (status === 'ACTIVE') {
        let monthlyPortion = 0;
        if (!app?.billingPeriod || app.billingPeriod === 'MONTHLY') {
          monthlyPortion = netPrice;
        } else if (app.billingPeriod === 'ANNUAL') {
          monthlyPortion = Math.round(netPrice / 12);
        }
        totalMonthlyCents += monthlyPortion;
      }

      return {
        moduleKey: def.key,
        name: def.name,
        description: def.description,
        version: def.version,
        color: def.color,
        icon: def.icon,
        applicationId: app?.id || null,
        status,
        isLifetime: app ? app.validUntil === null : false,
        plan: app?.plan || 'pro',
        priceCents: rawPrice,
        billingPeriod: app?.billingPeriod || 'MONTHLY',
        currency: app?.currency || 'EUR',
        discountPercent: discount,
        billingNotes: app?.billingNotes || null,
        validFrom: app?.validFrom || null,
        validUntil: app?.validUntil || null,
        graceDays: app?.graceDays ?? 7,
        usersCount: app?.assignments?.length || 0,
        assignments: app?.assignments?.map((a: any) => ({
          userId: a.user.id,
          userName: a.user.name || a.user.email,
          userEmail: a.user.email,
          isEmailVerified: Boolean(a.user.emailVerifiedAt),
          roleInApp: a.roleInApp,
          status: a.status
        })) || []
      };
    });

    const tenantUsers = tenant.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      isEmailVerified: Boolean(u.emailVerifiedAt)
    }));

    return reply.send({
      success: true,
      tenantId: tenant.id,
      tenantName: tenant.name,
      entitlementsVersion: tenant.entitlementsVersion,
      totalMonthlyCents,
      modules: modulesList,
      users: tenantUsers
    });
  }

  /**
   * PUT /api/platform/tenants/:tenantId/licensing/:moduleKey
   * Atualiza ou cria licença de módulo para um tenant com invalidação imediata de cache
   */
  static async updateTenantLicensingModule(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores de plataforma podem gerir licenciamento.' });
    }

    const { tenantId, moduleKey } = req.params as { tenantId: string; moduleKey: string };
    const canonicalKey = resolveCanonicalModuleKey(moduleKey);

    if (!isModuleRegistered(canonicalKey)) {
      return reply.status(400).send({ error: 'INVALID_MODULE_KEY', message: `O módulo '${moduleKey}' não é reconhecido no sistema.` });
    }

    const schema = z.object({
      status: z.enum(['ACTIVE', 'TRIAL', 'DISABLED', 'ARCHIVED']).default('ACTIVE'),
      plan: z.string().optional().default('pro'),
      priceCents: z.number().int().min(0).optional().default(0),
      billingPeriod: z.enum(['MONTHLY', 'ANNUAL', 'ONE_TIME']).optional().default('MONTHLY'),
      currency: z.string().optional().default('EUR'),
      discountPercent: z.number().min(0).max(100).optional().default(0),
      billingNotes: z.string().optional().nullable(),
      validFrom: z.string().optional().nullable(),
      validUntil: z.string().optional().nullable(),
      graceDays: z.number().int().min(0).optional().default(7),
      config: z.record(z.unknown()).optional().default({}),
      authorizedUserIds: z.array(z.string()).optional()
    });

    const body = schema.parse(req.body || {});

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return reply.status(404).send({ error: 'TENANT_NOT_FOUND', message: 'Empresa não encontrada.' });
    }

    const modDef = SYSTEM_MODULES[canonicalKey];
    let mod = await prisma.module.findFirst({ where: { key: canonicalKey } });
    if (!mod) {
      mod = await prisma.module.create({
        data: {
          key: canonicalKey,
          name: modDef?.name || canonicalKey.toUpperCase(),
          description: modDef?.description,
          isActive: true
        }
      });
    }

    const parseDate = (d?: string | null) => (d ? new Date(d) : null);

    const appInstance = await prisma.applicationInstance.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } },
      create: {
        tenantId,
        moduleId: mod.id,
        status: body.status as any,
        plan: body.plan,
        priceCents: body.priceCents,
        billingPeriod: body.billingPeriod,
        currency: body.currency,
        discountPercent: body.discountPercent,
        billingNotes: body.billingNotes,
        validFrom: parseDate(body.validFrom),
        validUntil: parseDate(body.validUntil),
        graceDays: body.graceDays,
        config: body.config as any,
        createdBy: user.sub
      },
      update: {
        status: body.status as any,
        plan: body.plan,
        priceCents: body.priceCents,
        billingPeriod: body.billingPeriod,
        currency: body.currency,
        discountPercent: body.discountPercent,
        billingNotes: body.billingNotes,
        validFrom: parseDate(body.validFrom),
        validUntil: parseDate(body.validUntil),
        graceDays: body.graceDays,
        config: body.config as any
      }
    });

    // Se foram especificados utilizadores autorizados, validar e associar
    if (body.authorizedUserIds && Array.isArray(body.authorizedUserIds)) {
      for (const uid of body.authorizedUserIds) {
        const u = await prisma.user.findFirst({ where: { id: uid, tenantId } });
        if (!u) {
          return reply.status(404).send({ error: 'USER_NOT_FOUND', message: `Utilizador ${uid} não encontrado nesta empresa.` });
        }
        if (!u.emailVerifiedAt) {
          return reply.status(400).send({
            error: 'EMAIL_NOT_VERIFIED',
            message: `O utilizador '${u.name || u.email}' ainda não validou o endereço de email. Envie o email de validação antes de lhe atribuir licença.`,
            userId: u.id,
            userEmail: u.email
          });
        }
      }

      await prisma.applicationAssignment.updateMany({
        where: {
          applicationId: appInstance.id,
          userId: { notIn: body.authorizedUserIds }
        },
        data: { status: 'REMOVED' }
      });

      for (const uid of body.authorizedUserIds) {
        await prisma.applicationAssignment.upsert({
          where: { userId_applicationId: { userId: uid, applicationId: appInstance.id } },
          create: {
            userId: uid,
            applicationId: appInstance.id,
            roleInApp: 'USER',
            status: 'ACTIVE'
          },
          update: { status: 'ACTIVE' }
        });
      }
    }

    if (canonicalKey === 'finance' && body.status === 'ACTIVE') {
      await seedFinancas(tenantId);
    }

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { entitlementsVersion: { increment: 1 } }
    });

    EntitlementService.invalidateCache(tenantId);

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      tenantId,
      action: 'licensing.updated',
      resource: 'ApplicationInstance',
      resourceId: appInstance.id,
      newValue: { moduleKey: canonicalKey, ...body },
      result: 'SUCCESS'
    });

    return reply.send({
      success: true,
      message: `Licença do módulo '${canonicalKey}' atualizada com sucesso.`,
      application: appInstance,
      entitlementsVersion: updatedTenant.entitlementsVersion
    });
  }

  /**
   * DELETE /api/platform/tenants/:tenantId/licensing/:moduleKey
   * Desativa a licença de um módulo para um tenant
   */
  static async disableTenantLicensingModule(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores de plataforma podem desativar licenciamentos.' });
    }

    const { tenantId, moduleKey } = req.params as { tenantId: string; moduleKey: string };
    const canonicalKey = resolveCanonicalModuleKey(moduleKey);

    const mod = await prisma.module.findFirst({ where: { key: canonicalKey } });
    if (!mod) {
      return reply.status(404).send({ error: 'MODULE_NOT_FOUND', message: 'Módulo não encontrado.' });
    }

    const existingApp = await prisma.applicationInstance.findUnique({
      where: { tenantId_moduleId: { tenantId, moduleId: mod.id } }
    });

    if (!existingApp) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Licença não existente para este tenant.' });
    }

    const updatedApp = await prisma.applicationInstance.update({
      where: { id: existingApp.id },
      data: { status: 'DISABLED' }
    });

    const updatedTenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { entitlementsVersion: { increment: 1 } }
    });

    EntitlementService.invalidateCache(tenantId);

    await AuditService.audit({
      actorId: user.sub,
      actorEmail: user.email,
      actorType: 'SUPER_ADMIN',
      tenantId,
      action: 'licensing.disabled',
      resource: 'ApplicationInstance',
      resourceId: updatedApp.id,
      newValue: { moduleKey: canonicalKey, status: 'DISABLED' },
      result: 'SUCCESS'
    });

    return reply.send({
      success: true,
      message: `Licença do módulo '${canonicalKey}' foi desativada com sucesso.`,
      application: updatedApp,
      entitlementsVersion: updatedTenant.entitlementsVersion
    });
  }

  /**
   * GET /api/platform/licensing/renewals
   * Lista próximas renovações nos próximos X dias
   */
  static async getUpcomingRenewals(req: FastifyRequest, reply: FastifyReply) {
    const user = req.user as any;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Acesso restrito ao Super Admin.' });
    }

    const query = req.query as { days?: string };
    const days = parseInt(query.days || '30', 10);

    const now = new Date();
    const future = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const apps = await prisma.applicationInstance.findMany({
      where: {
        status: 'ACTIVE',
        validUntil: {
          gte: now,
          lte: future
        },
        deletedAt: null
      },
      include: {
        module: true,
        tenant: { select: { id: true, name: true, slug: true, email: true } }
      },
      orderBy: { validUntil: 'asc' }
    });

    return reply.send({
      success: true,
      count: apps.length,
      daysAhead: days,
      renewals: apps.map(app => ({
        applicationId: app.id,
        tenantId: app.tenantId,
        tenantName: app.tenant.name,
        tenantSlug: app.tenant.slug,
        tenantEmail: app.tenant.email,
        moduleKey: resolveCanonicalModuleKey(app.module.key),
        moduleName: app.module.name,
        priceCents: app.priceCents,
        currency: app.currency,
        validUntil: app.validUntil,
        graceDays: app.graceDays,
        billingPeriod: app.billingPeriod
      }))
    });
  }

}
