import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EntitlementService, AppEntitlement } from '../modules/platform/services/EntitlementService';
import { AppError } from '../utils/errors';

declare module 'fastify' {
  interface FastifyRequest {
    entitlement?: AppEntitlement;
  }
  interface FastifyInstance {
    requireApp: (moduleKey: string, opts?: { write?: boolean }) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app: FastifyInstance) => {
  const entitlementService = new EntitlementService();

  app.decorate('requireApp', (moduleKey: string, opts?: { write?: boolean }) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        throw AppError.unauthorized('Autenticação necessária.');
      }

      const manifest = await entitlementService.resolveForUser(request.user.sub, request.user.tenantId);
      const targetKey = moduleKey === 'financas' ? 'finance' : (moduleKey === 'finance' ? 'financas' : moduleKey);
      const appEnt = manifest.apps.find((a) => a.key === moduleKey || a.key === targetKey);

      if (!appEnt || appEnt.state === 'NONE' || appEnt.state === 'DISABLED') {
        throw new AppError('APP_NOT_LICENSED', `O módulo '${moduleKey}' não está licenciado para a sua empresa.`, 403);
      }

      const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

      if (appEnt.state === 'SUSPENDED' && (isWriteMethod || opts?.write)) {
        throw new AppError('APP_READ_ONLY', `O módulo '${moduleKey}' está suspenso (modo só leitura). Não são permitidas escritas.`, 403);
      }

      if (appEnt.roleInApp === null && request.user.role !== 'SUPER_ADMIN') {
        throw new AppError('APP_NOT_ASSIGNED', `O seu utilizador não foi atribuído ao aplicativo '${moduleKey}'.`, 403);
      }

      if (request.method === 'POST') {
        for (const [limitKey, limitVal] of Object.entries(appEnt.limits || {})) {
          const currentUsage = appEnt.usage[limitKey] || 0;
          if (currentUsage >= limitVal) {
            throw new AppError('LIMIT_EXCEEDED', `Limite do plano atingido para '${limitKey}' (${currentUsage}/${limitVal}). Faça upgrade do plano.`, 403, { limit: limitVal, current: currentUsage });
          }
        }
      }

      request.entitlement = appEnt;
    };
  });

  app.decorate('requirePermission', (permission: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        throw AppError.unauthorized('Autenticação necessária.');
      }

      if (request.user.role === 'SUPER_ADMIN' || request.user.role === 'TENANT_OWNER') return;

      const manifest = await entitlementService.resolveForUser(request.user.sub, request.user.tenantId);
      
      const hasPermission = manifest.apps.some((a) => {
        if (a.state === 'NONE' || a.state === 'DISABLED' || a.state === 'SUSPENDED') return false;
        if (!a.roleInApp && request.user?.role !== 'TENANT_ADMIN') return false;
        return a.permissions.includes(permission);
      });

      if (!hasPermission) {
        throw new AppError('PERMISSION_DENIED', `Permissão necessária em falta: ${permission}`, 403);
      }
    };
  });
});

