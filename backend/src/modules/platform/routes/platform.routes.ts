import { FastifyInstance } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { applicationsRoutes } from './applications.routes';
import { ApplicationController } from '../controllers/ApplicationController';
import { AuditService } from '../services/AuditService';

export async function platformRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    await app.authenticate(request, reply);
    if (request.user?.role !== 'SUPER_ADMIN' && request.user?.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ message: 'Acesso negado.' });
    }
  });

  // GET /api/platform/tenants
  app.get('/tenants', async (request, reply) => {
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: { select: { users: true } },
        users: { where: { isOnline: true } },
        branding: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    return reply.status(200).send({
      tenants: tenants.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        email: t.email,
        phone: t.phone,
        city: t.city,
        country: t.country,
        status: t.status,
        createdAt: t.createdAt,
        userCount: t._count.users,
        onlineCount: t.users.length,
        branding: t.branding
      }))
    });
  });

  // POST /api/platform/tenants — Criar nova empresa
  app.post('/tenants', async (request, reply) => {
    const { name, email, phone, city, status } = request.body as any;
    if (!name) {
      return reply.status(400).send({ message: 'O nome da empresa é obrigatório.' });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.floor(Math.random() * 1000);

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        email: email || null,
        phone: phone || null,
        city: city || null,
        status: status || 'ACTIVE'
      }
    });

    await prisma.tenantBranding.create({
      data: {
        tenantId: tenant.id,
        displayName: name,
        legalName: name,
        primaryColor: '#0d419f',
        accentColor: '#1f6feb',
        theme: 'system',
        currency: 'EUR',
        country: 'PT'
      }
    });

    await AuditService.audit({
      actorId: request.user!.sub,
      actorEmail: request.user!.email,
      actorType: 'SUPER_ADMIN',
      tenantId: tenant.id,
      action: 'tenant.create',
      resource: 'Tenant',
      resourceId: tenant.id,
      newValue: tenant,
      result: 'SUCCESS'
    });

    return reply.status(201).send({ success: true, tenant });
  });

  // PATCH /api/platform/tenants/:id/status — Alterar estado da empresa
  app.patch('/tenants/:id/status', async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { status }
    });

    await AuditService.audit({
      actorId: request.user!.sub,
      actorEmail: request.user!.email,
      actorType: 'SUPER_ADMIN',
      tenantId: tenant.id,
      action: 'tenant.status.update',
      resource: 'Tenant',
      resourceId: tenant.id,
      newValue: { status },
      result: 'SUCCESS'
    });

    return reply.status(200).send({ success: true, tenant });
  });

  // GET /api/platform/users
  app.get('/users', async (request, reply) => {
    const { online } = request.query as { online?: string };

    const users = await prisma.user.findMany({
      where: online === 'true' ? { isOnline: true } : undefined,
      include: { tenant: true },
      orderBy: { createdAt: 'desc' }
    });
    return reply.status(200).send({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        tenantId: u.tenantId,
        tenantName: u.tenant?.name,
        role: u.role,
        status: u.status,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen
      }))
    });
  });

  // PATCH /api/platform/users/:id/status
  app.patch('/users/:id/status', async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const user = await prisma.user.update({
      where: { id },
      data: { status, active: status === 'ACTIVE' }
    });

    await AuditService.audit({
      actorId: request.user!.sub,
      actorEmail: request.user!.email,
      actorType: 'SUPER_ADMIN',
      tenantId: user.tenantId,
      action: 'user.status.update',
      resource: 'User',
      resourceId: user.id,
      newValue: { status },
      result: 'SUCCESS'
    });

    return reply.status(200).send({ success: true, user });
  });

  // GET /api/platform/account-requests — Listar pedidos pendentes
  app.get('/account-requests', async (request, reply) => {
    const requests = await prisma.accountRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return reply.status(200).send({ requests });
  });

  // GET /api/platform/roles — Listar perfis e permissões RBAC
  app.get('/roles', async (request, reply) => {
    const permissions = await prisma.permission.findMany({
      include: { rolePermissions: true }
    });

    const roles = ['SUPER_ADMIN', 'TENANT_ADMIN', 'SALES', 'MANAGER', 'USER', 'READ_ONLY'];
    return reply.status(200).send({ roles, permissions });
  });

  app.post('/impersonate', ApplicationController.startImpersonation);
  app.post('/impersonate/end', ApplicationController.endImpersonation);
  app.post('/account-requests/:id/approve', ApplicationController.approveAccountRequest);
  app.post('/account-requests/:id/reject', ApplicationController.rejectAccountRequest);

  app.get('/licensing/summary', ApplicationController.getLicensingSummary);

  // Auditoria
  app.get('/audit-chain/verify', async (request, reply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const result = await AuditService.verifyAuditChain(tenantId);
    return reply.status(200).send(result);
  });

  app.get('/audit/logs', async (request, reply) => {
    const query = request.query as any;
    const result = await AuditService.listLogs({
      tenantId: query.tenantId,
      module: query.module,
      category: query.category,
      action: query.action,
      actorId: query.actorId,
      resource: query.resource,
      resourceId: query.resourceId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      offset: query.offset ? parseInt(query.offset, 10) : 0
    });
    return reply.status(200).send(result);
  });

  app.get('/audit/dashboard', async (request, reply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const metrics = await AuditService.getDashboardMetrics(tenantId);
    return reply.status(200).send({ success: true, ...metrics });
  });

  app.get<{ Params: { resource: string; resourceId: string } }>('/audit/resource/:resource/:resourceId', async (request, reply) => {
    const { resource, resourceId } = request.params;
    const { tenantId } = request.query as { tenantId?: string };
    const timeline = await AuditService.getResourceTimeline(resource, resourceId, tenantId);
    return reply.status(200).send({ success: true, timeline });
  });

  // Módulos como Aplicativos — gestão por tenant
  app.register(applicationsRoutes, { prefix: '/applications' });
}
