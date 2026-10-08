import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../../utils/errors';
import { TenantMailService, type MailActor } from '../services/TenantMailService';

// =============================================================================
// /api/tenant/email — definições de envio de email do tenant
//
// Não é um módulo licenciável (não usa requireApp): é uma definição da empresa,
// usada por todos os módulos que enviam email. Por isso o controlo é por papel:
// só o dono/administrador do tenant (ou o super-admin em sessão de suporte com
// escrita) pode ver e alterar a configuração. Qualquer utilizador autenticado
// pode consultar o estado resumido (para os ecrãs avisarem "email por configurar").
//
// O tenant vem SEMPRE da sessão (request.user.tenantId), nunca do pedido.
// =============================================================================

export const EMAIL_SETTINGS_ROLES = new Set(['SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN']);

function serviceFor(request: FastifyRequest) {
  if (!request.user || !request.db) {
    throw AppError.unauthorized('Autenticação necessária.');
  }
  return new TenantMailService(request.user.tenantId, request.db);
}

function actorFor(request: FastifyRequest): MailActor {
  return {
    userId: request.user?.actingUserId || request.user?.sub,
    email: request.user?.email,
    role: request.user?.role,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent']
  };
}

async function requireEmailAdmin(request: FastifyRequest) {
  if (!request.user || !EMAIL_SETTINGS_ROLES.has(request.user.role)) {
    throw new AppError(
      'PERMISSION_DENIED',
      'Só o administrador da empresa pode gerir as definições de email.',
      403
    );
  }
}

export async function tenantMailRoutes(app: FastifyInstance) {
  app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', app.authenticate);

    protectedApp.get('/status', async (request, reply) => {
      return reply.status(200).send({ success: true, status: await serviceFor(request).getStatus() });
    });

    protectedApp.get('/settings', { preHandler: requireEmailAdmin }, async (request, reply) => {
      return reply.status(200).send({ success: true, settings: await serviceFor(request).getSettings() });
    });

    protectedApp.put(
      '/settings',
      { preHandler: requireEmailAdmin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const settings = await serviceFor(request).saveSettings(request.body, actorFor(request));
        return reply.status(200).send({ success: true, settings });
      }
    );

    protectedApp.post(
      '/test',
      { preHandler: requireEmailAdmin, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const actor = actorFor(request);
        if (!actor.email) {
          throw new AppError('ACTOR_EMAIL_MISSING', 'A sua sessão não tem email associado para receber o teste.', 400);
        }
        const result = await serviceFor(request).testSettings({ ...actor, email: actor.email });
        return reply.status(200).send({ success: true, result });
      }
    );

    protectedApp.get('/logs', { preHandler: requireEmailAdmin }, async (request, reply) => {
      const limit = Number((request.query as { limit?: string })?.limit) || 50;
      return reply.status(200).send({ success: true, logs: await serviceFor(request).listRecentSends(limit) });
    });
  });
}
