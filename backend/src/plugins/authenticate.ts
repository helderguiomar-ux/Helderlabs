import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { forTenant, type TenantScopedPrismaClient } from '../database/prisma/tenantScopedClient';

export interface AuthTokenPayload {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  email: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    // Preenchidos pelo hook `authenticate` — só existem depois dele correr.
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

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as any
  });
}

/**
 * Plugin Fastify que expõe `app.authenticate` como preHandler.
 *
 * O que faz, por pedido autenticado:
 *  1. Lê e valida o JWT do header `Authorization: Bearer <token>`.
 *  2. Extrai { userId, tenantId, role, email } do token — NUNCA de
 *     query/body/params enviados pelo cliente. Isto é o que fecha a fuga
 *     que existia antes (tenantId vinha de ?tenantId=... na query).
 *  3. Decora `request.user` com esses dados e `request.db` com um Prisma
 *     Client já "amarrado" ao tenant (ver tenantScopedClient.ts) — os
 *     services usam sempre `request.db`, nunca o client global.
 */
export default fp(async (app) => {
  app.decorateRequest('user', undefined);
  app.decorateRequest('db', undefined);

  app.decorate('authenticate', async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    const header = request.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ message: 'Token em falta. Envia "Authorization: Bearer <token>".' });
    }

    const token = header.slice('Bearer '.length).trim();

    // Só a verificação do JWT em si mapeia para 401. Isto é
    // deliberadamente separado do que vem a seguir: numa primeira versão,
    // forTenant() (que toca no Prisma Client) estava dentro do mesmo
    // try/catch, e uma falha totalmente alheia ao token — por exemplo o
    // Prisma Client ainda não ter sido gerado, ou a base de dados estar
    // em baixo — aparecia ao cliente como "Token inválido ou expirado.",
    // o que é enganador e dificulta o diagnóstico. Detetado a testar esta
    // rota sem `prisma generate` correr (como acontece nesta sandbox).
    let payload: AuthTokenPayload;
    try {
      payload = jwt.verify(token, getJwtSecret()) as AuthTokenPayload;

      if (!payload.sub || !payload.tenantId || !payload.role) {
        throw new Error('Token com payload incompleto.');
      }
    } catch (error) {
      return reply.status(401).send({ message: 'Token inválido ou expirado.' });
    }

    request.user = payload;
    // Propositadamente FORA do try/catch acima: se isto falhar (ex.: Prisma
    // Client não gerado, BD em baixo), deixa o erro seguir para o error
    // handler por omissão do Fastify (500), em vez de ser mascarado como
    // problema de autenticação.
    request.db = forTenant(payload.tenantId);
  });
});
