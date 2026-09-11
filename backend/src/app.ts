import { setupWebsocket } from './websocket';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import authenticatePlugin from './plugins/authenticate';
import entitlementsPlugin from './plugins/entitlements';
import { authRoutes } from './modules/auth/routes/auth.routes';
import { publicRoutes } from './routes/public.routes';
import { crmRoutes } from './modules/crm/routes/crm.routes';
import { condominiosRoutes } from './modules/condominios/routes/condominios.routes';
import { financasRoutes } from './modules/financas/routes/financas.routes';
import { financeModuleRoutes } from './modules/finance/routes/index';
import { platformRoutes } from './modules/platform/routes/platform.routes';
import { hccallRoutes } from './modules/hccall/routes/hccall.routes';
import { sellmaisRoutes } from './modules/sellmais/routes/sellmais.routes';
import { SellPublicCatalogService } from './modules/sellmais/services/SellPublicCatalogService';
import { checkDatabaseReady } from './database/prisma/client';
import { EntitlementService } from './modules/platform/services/EntitlementService';
import { AuditService } from './modules/platform/services/AuditService';
import { VersionController } from './modules/platform/controllers/VersionController';

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
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
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
      (error.name === 'PrismaClientKnownRequestError' && (error as any).code?.startsWith('P1'))
    ) {
      app.log.error({ err: error, reqId: request.id }, 'Prisma error');
      return reply.status(503).send({
        error: 'DATABASE_UNAVAILABLE',
        message: 'O serviço está temporariamente indisponível.'
      });
    }

    if (error.name === 'PrismaClientKnownRequestError' && (error as any).code === 'P2022') {
      app.log.error({ err: error, reqId: request.id }, 'Prisma schema mismatch P2022');
      return reply.status(503).send({
        error: 'DATABASE_SCHEMA_UPDATING',
        message: 'A base de dados de produção está a ser atualizada. Por favor tente dentro de breves instantes.'
      });
    }

    const statusCode = (error as any).statusCode ?? 500;
    const errorCode = (error as any).code ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
    if (statusCode >= 500) {
      app.log.error({ err: error, reqId: request.id }, 'Internal server error');
    } else {
      app.log.warn({ err: error, reqId: request.id }, 'Client error');
    }

    reply.status(statusCode).send({
      error: errorCode,
      message: error.message || 'Ocorreu um erro interno. A nossa equipa já foi notificada.'
    });
  });

  app.register(authenticatePlugin);
  app.register(entitlementsPlugin);

  const staticRoot = path.join(__dirname, '../public');
  app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: 'index.html'
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/health' && request.url !== '/api/version') {
      const isDbReady = await checkDatabaseReady();
      if (!isDbReady) {
        return reply.status(503).send({
          error: 'DATABASE_UNAVAILABLE',
          message: 'O serviço está temporariamente indisponível. A base de dados está em inicialização ou recuperação.'
        });
      }
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if (request.url.startsWith('/api/') && request.method !== 'GET' && request.url !== '/api/health') {
      const pathParts = request.url.split('?')[0].split('/');
      const moduleName = pathParts[2] || 'plataforma';
      const isSecurity =
        moduleName === 'auth' ||
        request.url.includes('/impersonate') ||
        request.url.includes('/roles') ||
        reply.statusCode === 401 ||
        reply.statusCode === 403;
      const category = isSecurity ? 'SECURITY' : 'APPLICATION';

      await AuditService.audit({
        action: `${moduleName}.${request.method.toLowerCase()}`,
        module: moduleName,
        category,
        resource: request.url.split('?')[0],
        result: reply.statusCode < 400 ? 'SUCCESS' : 'FAILURE',
        tenantId: request.user?.tenantId,
        actorId: request.user?.sub,
        actorEmail: request.user?.email,
        actorType: request.user?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
        onBehalfOfId: request.user?.onBehalfOfId,
        impersonationId: request.user?.impersonationId,
        requestId: request.id,
        ipAddress: request.ip,
        userAgent: (request.headers['user-agent'] as string) || undefined
      });
    }
  });

  app.get('/api/health', async () => {
    const isDbReady = await checkDatabaseReady(true);
    return {
      application: 'healthy',
      database: isDbReady ? 'ready' : 'unavailable',
      authentication: isDbReady ? 'healthy' : 'degraded',
      version: process.env.VERSION || '1.0.0',
      environment: process.env.ENVIRONMENT || 'DEVELOPMENT'
    };
  });

  app.get('/api/version', VersionController.getVersion);

  app.get('/health', async (request, reply) => {
    reply.redirect('/api/health');
  });

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(publicRoutes, { prefix: '/api/public' });
  app.register(platformRoutes, { prefix: '/api/platform' });
  app.register(crmRoutes, { prefix: '/api/crm' });
  app.register(condominiosRoutes, { prefix: '/api/condominios' });
  app.register(financasRoutes, { prefix: '/api/financas' });
  app.register(financeModuleRoutes, { prefix: '/api/finance' });
  app.register(hccallRoutes, { prefix: '/api/hccall' });
  app.register(sellmaisRoutes, { prefix: '/api/sellmais' });

  // -------------------------------------------------------------------------
  // Catálogo Público 2SELLMAIS (SSR com SEO e OpenGraph)
  // -------------------------------------------------------------------------
  app.get('/loja', async (request, reply) => {
    const html = await SellPublicCatalogService.renderStorefrontHtml();
    return reply.type('text/html').send(html);
  });

  app.get('/loja/artigo/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { html, found } = await SellPublicCatalogService.renderItemHtml(slug);
    return reply.status(found ? 200 : 404).type('text/html').send(html);
  });

  const entitlementService = new EntitlementService();
  app.register(async (instance) => {
    instance.get('/api/me/workspace', { preHandler: [instance.authenticate] }, async (request, reply) => {
      const manifest = await entitlementService.resolveForUser(request.user!.sub, request.user!.tenantId);
      return reply.status(200).send(manifest);
    });
  });

  setupWebsocket(app);

  return app;
}
