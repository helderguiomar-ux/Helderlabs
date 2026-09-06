import { setupWebsocket } from './websocket';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
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

  // Helmet — Cabeçalhos de Segurança & CSP
  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:', 'wss:']
      }
    },
    crossOriginEmbedderPolicy: false
  });

  // Rate Limiting Global (100 pedidos/min por omissão)
  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute'
  });

  // CORS dinâmico por ambiente
  const defaultAllowedOrigins = [
    'https://helderlabs.eu',
    'https://www.helderlabs.eu',
    'http://localhost:3333',
    'http://localhost:3000',
    'http://127.0.0.1:3333'
  ];

  const rawOrigins = process.env.ALLOWED_ORIGINS;
  const customOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...customOrigins]));

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      try {
        const host = new URL(origin).hostname;
        if (
          host === 'helderlabs.eu' ||
          host.endsWith('.helderlabs.eu') ||
          host.endsWith('.vercel.app') ||
          host === 'localhost' ||
          host === '127.0.0.1'
        ) {
          return callback(null, true);
        }
      } catch (e) {}

      callback(new Error(`CORS: origin não permitida: ${origin}`), false);
    },
    credentials: true
  });

  // ÚNICO Error Handler Global
  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: 'TOO_MANY_REQUESTS',
        message: 'Demasiados pedidos num curto período. Por favor, tente novamente mais tarde.'
      });
    }

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

  app.register(authenticatePlugin);

  const staticRoot = path.join(__dirname, '../public');
  app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: 'index.html'
  });

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

  app.get('/health', async (request, reply) => {
    reply.redirect('/api/health');
  });

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(platformRoutes, { prefix: '/api/platform' });
  app.register(crmRoutes, { prefix: '/api/crm' });
  app.register(condominiosRoutes, { prefix: '/api/condominios' });

  setupWebsocket(app);

  return app;
}
