import { setupWebsocket } from './websocket';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import authenticatePlugin from './plugins/authenticate';
import { authRoutes } from './modules/auth/routes/auth.routes';
import { crmRoutes } from './modules/crm/routes/crm.routes';
import { condominiosRoutes } from './modules/condominios/routes/condominios.routes';
import { platformRoutes } from './modules/platform/routes/platform.routes';
import { checkDatabaseReady } from './database/prisma/client';

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  // ---------------------------------------------------------------------------
  // CORS dinâmico por ambiente
  // Dev:  aceita localhost por omissão
  // Prod: lê ALLOWED_ORIGINS (CSV) das env vars — ex: "https://helderlabs.eu"
  // ---------------------------------------------------------------------------
  const rawOrigins = process.env.ALLOWED_ORIGINS;
  const allowedOrigins: string[] = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:3333', 'http://localhost:3000', 'http://127.0.0.1:3333'];

  app.register(cors, {
    origin: (origin, callback) => {
      // Sem Origin (curl, server-to-server, SSR) → sempre ok
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin não permitida: ${origin}`), false);
    },
    credentials: true
  });

  // ---------------------------------------------------------------------------
  // ÚNICO Error Handler Global
  //
  // Ordem de verificação (mais específico → mais genérico):
  //   1. ZodError          → 400 Pedido inválido
  //   2. DB recovery/down  → 503 Temporariamente indisponível
  //   3. Prisma errors     → 503 Temporariamente indisponível
  //   4. Resto             → 500 Erro interno
  //
  // NOTA: Fastify só usa o último setErrorHandler registado. Por isso existe
  // APENAS UM aqui, antes de qualquer plugin ou rota.
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    // 1. Erros de validação Zod (input inválido do cliente)
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Pedido inválido.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    // 2. Base de dados em modo de recuperação / inacessível
    if (
      error.message &&
      (error.message.includes('FATAL: the database system is in recovery mode') ||
        error.message.includes("Can't reach database server"))
    ) {
      app.log.warn({ err: error, reqId: request.id }, 'DB unavailable — recovery mode');
      return reply.status(503).send({
        error: 'DATABASE_UNAVAILABLE',
        message: 'O serviço está temporariamente indisponível. Estamos a preparar/recuperar o sistema.',
        details: 'Tente novamente em breves instantes.'
      });
    }

    // 3. Erros de inicialização / query do Prisma
    if (
      error.name === 'PrismaClientInitializationError' ||
      error.name === 'PrismaClientKnownRequestError'
    ) {
      app.log.error({ err: error, reqId: request.id }, 'Prisma error');
      return reply.status(503).send({
        error: 'DATABASE_UNAVAILABLE',
        message: 'O serviço está temporariamente indisponível.'
      });
    }

    // 4. Erro genérico — respeitar statusCode se já vem definido (ex: 401, 403)
    const statusCode = (error as any).statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error({ err: error, reqId: request.id }, 'Internal server error');
    } else {
      app.log.warn({ err: error, reqId: request.id }, 'Client error');
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: error.message || 'Ocorreu um erro interno. A nossa equipa já foi notificada.'
    });
  });

  // ---------------------------------------------------------------------------
  // Plugins: autenticação JWT (expõe app.authenticate + decora request.user)
  // ---------------------------------------------------------------------------
  app.register(authenticatePlugin);

  // ---------------------------------------------------------------------------
  // Frontend estático: servido a partir de /public
  // Em produção o mesmo processo serve HTML + API (sem separação de deploy).
  // ---------------------------------------------------------------------------
  const staticRoot = path.join(__dirname, '../public');
  app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: 'index.html'
  });

  // ---------------------------------------------------------------------------
  // DB Guard — verifica disponibilidade antes de qualquer rota /api/*
  // (exceto /api/health que é sempre acessível para health checks)
  // ---------------------------------------------------------------------------
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/health') {
      const isDbReady = await checkDatabaseReady();
      if (!isDbReady) {
        return reply.status(503).send({
          error: 'DATABASE_UNAVAILABLE',
          message: 'O serviço está temporariamente indisponível. A base de dados está em inicialização ou recuperação.'
        });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Health check — sempre disponível, sem autenticação
  // ---------------------------------------------------------------------------
  app.get('/api/health', async () => {
    const isDbReady = await checkDatabaseReady(true);
    return {
      application: 'healthy',
      database: isDbReady ? 'ready' : 'unavailable',
      authentication: isDbReady ? 'healthy' : 'degraded',
      version: process.env.VERSION || '1.0.0-consolidada',
      environment: process.env.ENVIRONMENT || 'DEVELOPMENT'
    };
  });

  // Redirecionar /health → /api/health (retrocompatibilidade)
  app.get('/health', async (request, reply) => {
    reply.redirect('/api/health');
  });

  // ---------------------------------------------------------------------------
  // Rotas de API
  // ---------------------------------------------------------------------------

  // Autenticação (sem JWT obrigatório — é aqui que ele começa)
  app.register(authRoutes, { prefix: '/api/auth' });

  // Plataforma / Super Admin (acesso restrito a SUPER_ADMIN e PLATFORM_ADMIN)
  app.register(platformRoutes, { prefix: '/api/platform' });

  // CRM: Leads, Oportunidades, Clientes, Dashboard
  // (JWT obrigatório — ver crm.routes.ts)
  app.register(crmRoutes, { prefix: '/api/crm' });

  // Gestão de Condomínios
  // (JWT obrigatório — ver condominios.routes.ts)
  app.register(condominiosRoutes, { prefix: '/api/condominios' });

  // WebSocket (Socket.io) — presença em tempo real
  setupWebsocket(app);

  return app;
}
