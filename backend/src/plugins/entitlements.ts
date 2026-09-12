import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EntitlementService, AppEntitlement, WorkspaceManifest } from '../modules/platform/services/EntitlementService';
import { resolveCanonicalModuleKey } from '../config/modules';
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

// ---------------------------------------------------------------------------
// Cache de entitlements por (utilizador, tenant).
//
// requireApp() invocava EntitlementService.resolveForUser() em TODOS os
// pedidos autenticados, e requirePermission() outra vez — duas resoluções
// completas contra application_assignments/application_instances por pedido.
// É uma das causas medidas da lentidão no carregamento dos módulos.
//
// TTL curto para que alterações de licenciamento se reflitam depressa, e
// invalidação explícita disponível para quem altera atribuições.
// ---------------------------------------------------------------------------
const ENTITLEMENT_TTL_MS = 60_000;
const entitlementCache = new Map<string, { value: WorkspaceManifest; expiresAt: number }>();

export function invalidateEntitlementCache(userId?: string, tenantId?: string) {
  if (!userId) {
    entitlementCache.clear();
    return;
  }
  if (tenantId) {
    entitlementCache.delete(`${userId}:${tenantId}`);
    return;
  }
  for (const key of entitlementCache.keys()) {
    if (key.startsWith(`${userId}:`)) entitlementCache.delete(key);
  }
}

export default fp(async (app: FastifyInstance) => {
  const entitlementService = new EntitlementService();

  const resolveCached = async (userId: string, tenantId: string): Promise<WorkspaceManifest> => {
    const key = `${userId}:${tenantId}`;
    const now = Date.now();
    const hit = entitlementCache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await entitlementService.resolveForUser(userId, tenantId);
    entitlementCache.set(key, { value, expiresAt: now + ENTITLEMENT_TTL_MS });

    // Limite defensivo de memória por instância serverless.
    if (entitlementCache.size > 500) {
      for (const [k, v] of entitlementCache) {
        if (v.expiresAt <= now) entitlementCache.delete(k);
      }
    }
    return value;
  };

  app.decorate('requireApp', (moduleKey: string, opts?: { write?: boolean }) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        throw AppError.unauthorized('Autenticação necessária.');
      }

      const canonicalTarget = resolveCanonicalModuleKey(moduleKey);
      const manifest = await resolveCached(request.user.sub, request.user.tenantId);
      const appEnt = manifest.apps.find((a) => a.key === canonicalTarget && a.state !== 'NONE')
        || manifest.apps.find((a) => resolveCanonicalModuleKey(a.key) === canonicalTarget && a.state !== 'NONE')
        || manifest.apps.find((a) => a.key === canonicalTarget)
        || manifest.apps.find((a) => resolveCanonicalModuleKey(a.key) === canonicalTarget);

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

      const manifest = await resolveCached(request.user.sub, request.user.tenantId);

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

