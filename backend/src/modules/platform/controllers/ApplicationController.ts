import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas de validação
// ---------------------------------------------------------------------------

const CreateApplicationSchema = z.object({
  moduleId: z.string().min(1, 'moduleId é obrigatório'),
  tenantId: z.string().optional(),               // Super Admin pode especificar; outros usam o próprio
  status: z.enum(['DISABLED', 'TRIAL', 'ACTIVE', 'ARCHIVED']).default('TRIAL'),
  config: z.record(z.unknown()).optional().default({})
});

const UpdateApplicationSchema = z.object({
  status: z.enum(['DISABLED', 'TRIAL', 'ACTIVE', 'ARCHIVED']).optional(),
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
        createdBy: user.id
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
    const body = UpdateApplicationSchema.parse(req.body);

    const app = await prisma.applicationInstance.findUnique({ where: { id: applicationId } });
    if (!app) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Aplicativo não encontrado.' });
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

    const app = await prisma.applicationInstance.findUnique({ where: { id: applicationId } });
    if (!app) {
      return reply.status(404).send({ error: 'APPLICATION_NOT_FOUND', message: 'Aplicativo não encontrado.' });
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
}
