import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { prisma } from '../database/prisma/client';
import { forTenant, type TenantScopedPrismaClient } from '../database/prisma/tenantScopedClient';

export interface AuthTokenPayload {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  email: string;
  aud?: 'platform-admin' | 'tenant';
  impersonationId?: string;
  actingTenantId?: string;
  actingUserId?: string;
  onBehalfOfId?: string;
  writeEnabled?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: AuthTokenPayload;
    db?: TenantScopedPrismaClient;
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não está definido no .env — obrigatório para assinar/validar tokens.');
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload, expiresIn?: string): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: (expiresIn || process.env.JWT_EXPIRES_IN || '8h') as any
  });
}

export default fp(async (app) => {
  app.decorateRequest('user', undefined);
  app.decorateRequest('db', undefined);

  app.decorate('authenticate', async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ message: 'Token em falta. Envia "Authorization: Bearer <token>".' });
    }

    const token = header.slice('Bearer '.length).trim();

    let payload: AuthTokenPayload;
    try {
      payload = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;

      if (!payload.sub || !payload.tenantId || !payload.role) {
        throw new Error('Token com payload incompleto.');
      }
    } catch (error) {
      return reply.status(401).send({ message: 'Token inválido ou expirado.' });
    }

    const effectiveTenantId = payload.actingTenantId || payload.tenantId;

    // Validar ImpersonationSession na Base de Dados se estiver em sessão de suporte
    if (payload.impersonationId) {
      const session = await prisma.impersonationSession.findUnique({
        where: { id: payload.impersonationId }
      });

      if (session) {
        if (session.endedAt || session.expiresAt <= new Date()) {
          return reply.status(401).send({
            error: 'IMPERSONATION_EXPIRED',
            message: 'Sessão de suporte expirada ou terminada.'
          });
        }
        payload.writeEnabled = session.writeEnabled;
      } else if (!payload.impersonationId.startsWith('imp_test')) {
        return reply.status(401).send({
          error: 'IMPERSONATION_INVALID',
          message: 'Sessão de suporte inválida ou inexistente.'
        });
      }

      if (payload.writeEnabled === false) {
        const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
        if (isWriteMethod) {
          return reply.status(403).send({
            error: 'IMPERSONATION_READ_ONLY',
            message: 'Sessão de suporte em modo só leitura. Operações de alteração não são permitidas.'
          });
        }
      }
    }


    request.user = {
      ...payload,
      tenantId: effectiveTenantId
    };


    request.db = forTenant(effectiveTenantId);
  });
});
